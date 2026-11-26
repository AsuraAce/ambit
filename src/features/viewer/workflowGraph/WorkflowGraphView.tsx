import * as React from 'react';
import { ArrowLeft, ChevronDown, Maximize, Minus, Plus } from 'lucide-react';
import type { WorkflowCanvasReport } from '../../../bindings';
import { useWorkflowGraphStore } from '../../../stores/workflowGraphStore';
import { buildGraphModel, hasSavedPositions, savedPositions, type Positions } from './graphModel';
import {
    boundsOf,
    detailOpacity,
    fitView,
    FOLD_MS,
    GROUP_TITLE_H,
    groupBox,
    MIN_SCALE,
    nodeHeight,
    sceneFor,
    startView,
    viewLevel,
    wirePaths,
    zoomAt,
    zoomFloor,
    type LayoutMode,
    type Rect,
    type View,
    type ViewLevel,
    type WireShape,
} from './geometry';
import { FOLDED_GROUP_W } from './graphModel';
import { countFits, placeGroupTitle, TITLE_CHROME, TITLE_INSET } from './groupTitles';
import { groupColour, type Palette } from './groupColour';
import { drawFarScene, farSceneFor, prepareFarDrawing, readFarPalette, type FarDrawing } from './farCanvas';
import { GraphNode } from './GraphNode';
import { createLayoutWorker, useTidyPositions } from './useTidyPositions';
import './workflowGraph.css';

export interface WorkflowGraphViewProps {
    report: WorkflowCanvasReport;
    fileName: string;
    onClose: () => void;
    makeLayoutWorker?: () => Worker;
}

const FLY_MS = 560;
const MOVE_MS = 620;
/** How long the near and far views cross-fade at the switch; workflowGraph.css uses the same time. */
const CROSS_FADE_MS = 160;
const PAN_THRESHOLD = 3;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A folded box's room for its title and count: its width less borders, padding, gaps and the fold button (see .wg-gh). */
const FOLDED_TITLE_ROOM = FOLDED_GROUP_W - (2 + 12 + 12 + 8 + 8 + 22);
let measureContext: CanvasRenderingContext2D | null | undefined;
const textWidth = (text: string, px: number, weight: number, family: string): number => {
    if (measureContext === undefined) measureContext = document.createElement('canvas').getContext('2d');
    if (measureContext && typeof measureContext.measureText === 'function') {
        measureContext.font = `${weight} ${px}px ${family}`;
        return measureContext.measureText(text).width;
    }
    // No canvas (tests): an average glyph is about 0.6 of the font size.
    return text.length * px * 0.6;
};
const nodeCount = (count: number) => (count === 1 ? '1 node' : `${count} nodes`);

interface FoldMotion {
    leaving: ReadonlySet<string>;
    arriving: ReadonlySet<string>;
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** The full-screen, read-only workflow graph. Rendered by WorkflowInspector, so the viewer's privacy gate unmounts it. */
const WorkflowGraphView: React.FC<WorkflowGraphViewProps> = ({ report, fileName, onClose, makeLayoutWorker = createLayoutWorker }) => {
    const model = React.useMemo(() => buildGraphModel(report.root), [report]);
    const canShowSaved = report.hasSavedLayout && hasSavedPositions(model);
    const saved = React.useMemo(() => (canShowSaved ? savedPositions(model) : null), [canShowSaved, model]);
    const [layout, setLayout] = React.useState<LayoutMode>(canShowSaved ? 'saved' : 'tidy');
    const tidy = useTidyPositions(model, layout === 'tidy', makeLayoutWorker);
    // While Tidy is being worked out, the saved layout stays on screen.
    const positions: Positions | null = layout === 'tidy' ? (tidy.positions ?? saved) : saved;
    const shownLayout: LayoutMode = layout === 'tidy' && tidy.positions ? 'tidy' : saved ? 'saved' : 'tidy';

    const [foldedNodes, setFoldedNodes] = React.useState<ReadonlySet<string>>(
        () => new Set(model.nodes.filter((node) => node.collapsed).map((node) => node.id))
    );
    const [foldedGroups, setFoldedGroups] = React.useState<ReadonlySet<string>>(() => new Set());
    // Chosen from menus in a later package; the defaults are the piece's.
    const [palette] = React.useState<Palette>('quiet');
    const [shape] = React.useState<WireShape>('bundled');
    const [interacted, setInteracted] = React.useState(false);
    // Members of a group being folded stay drawn while they fade out; those of one being unfolded fade in. Each group
    // keeps its own motion and timer, so folding a second group mid-fade leaves the first one's fade alone.
    const [foldMotions, setFoldMotions] = React.useState<ReadonlyMap<string, FoldMotion>>(() => new Map());
    const foldMotion = React.useMemo(() => {
        const leaving = new Set<string>();
        const arriving = new Set<string>();
        for (const motion of foldMotions.values()) {
            for (const id of motion.leaving) leaving.add(id);
            for (const id of motion.arriving) arriving.add(id);
        }
        return { leaving, arriving };
    }, [foldMotions]);
    const scene = React.useMemo(() => sceneFor(model, shownLayout, foldedGroups), [model, shownLayout, foldedGroups]);
    const wires = React.useMemo(
        () => (positions ? wirePaths(model, positions, foldedNodes, scene, shape) : []),
        [model, positions, foldedNodes, scene, shape]
    );

    // Each open group's title is a pill at its top-left.
    const titleSlots = React.useMemo(() => {
        const slots = new Map<string, { rect: Rect; count: boolean }>();
        const family = getComputedStyle(document.documentElement).fontFamily || 'sans-serif';
        for (const group of model.groups) {
            if (scene.hiddenGroups.has(group.key) || foldedGroups.has(group.key)) continue;
            const titleW = textWidth(group.title, 13, 700, family);
            const countW = textWidth(nodeCount(group.members.length), 11, 500, family);
            // A narrow group drops the count before it cuts the title.
            const count = countFits(titleW, countW, group.w - 2 * TITLE_INSET - TITLE_CHROME);
            const width = titleW + TITLE_CHROME + (count ? countW : 0);
            const rect = placeGroupTitle(groupBox(group, false), width, GROUP_TITLE_H, TITLE_INSET);
            slots.set(group.key, { rect, count });
        }
        return slots;
    }, [model, scene, foldedGroups]);

    const rootRef = React.useRef<HTMLDivElement>(null);
    const backRef = React.useRef<HTMLButtonElement>(null);
    const canvasRef = React.useRef<HTMLDivElement>(null);
    const worldRef = React.useRef<HTMLDivElement>(null);
    const dotsRef = React.useRef<HTMLDivElement>(null);
    const zoomRef = React.useRef<HTMLSpanElement>(null);
    const farRef = React.useRef<HTMLCanvasElement>(null);
    const viewRef = React.useRef<View>({ x: 0, y: 0, s: 1 });
    const flightRef = React.useRef<number | null>(null);
    const frameRef = React.useRef<number | null>(null);
    const rectRef = React.useRef<DOMRect | null>(null);
    const isFarRef = React.useRef(false);
    const levelRef = React.useRef<ViewLevel>('near');
    const detailRef = React.useRef(1);
    // After leaving far mode the canvas fades out, and keeps following the view until it has.
    const farFadeEndRef = React.useRef(0);
    const foldTimersRef = React.useRef(new Map<string, number>());
    // The far drawing is built from the rendered graph on first use and dropped whenever the graph changes.
    const farDrawingRef = React.useRef<FarDrawing | null>(null);
    const farInputs = React.useRef({ model, positions, foldedNodes, foldedGroups, scene, wires });
    React.useLayoutEffect(() => {
        farInputs.current = { model, positions, foldedNodes, foldedGroups, scene, wires };
    });

    // The graph owns the keyboard while it is open: the viewer and app shortcuts stand down.
    const setGraphOpen = useWorkflowGraphStore((state) => state.setOpen);
    React.useEffect(() => {
        setGraphOpen(true);
        backRef.current?.focus();
        return () => setGraphOpen(false);
    }, [setGraphOpen]);

    // The canvas fills the window, so its rect changes only on resize; reading it per event forces layout.
    const canvasRect = React.useCallback(() => {
        if (!rectRef.current && canvasRef.current) rectRef.current = canvasRef.current.getBoundingClientRect();
        return rectRef.current;
    }, []);

    // Far mode hides the HTML world and paints plain boxes, wires and titles on one canvas the size of the view,
    // so a pan or zoom step repaints a few hundred shapes instead of every node's elements.
    const drawFar = React.useCallback(() => {
        const canvas = farRef.current;
        const layer = rootRef.current;
        const rect = canvasRect();
        if (!canvas || !layer || !rect || rect.width === 0 || rect.height === 0) return;
        const dpr = window.devicePixelRatio || 1;
        const width = Math.round(rect.width * dpr);
        const height = Math.round(rect.height * dpr);
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        let drawing = farDrawingRef.current;
        if (!drawing) {
            const inputs = farInputs.current;
            if (!inputs.positions) return;
            const laidOut = new Map<string, number>();
            worldRef.current?.querySelectorAll<HTMLElement>('[data-node-id]').forEach((element) => {
                if (element.offsetHeight > 0) laidOut.set(element.dataset.nodeId ?? '', element.offsetHeight);
            });
            const farScene = farSceneFor(
                inputs.model,
                inputs.positions,
                inputs.foldedNodes,
                inputs.foldedGroups,
                inputs.scene,
                inputs.wires,
                laidOut
            );
            drawing = prepareFarDrawing(farScene, readFarPalette(layer));
            farDrawingRef.current = drawing;
        }
        drawFarScene(ctx, drawing, viewRef.current, dpr, levelRef.current === 'overview' ? 'overview' : 'far');
    }, [canvasRect]);

    // Pan and zoom never re-render React: one transform on the world, the far canvas, the dot grid and the readout.
    const apply = React.useCallback(() => {
        const { x, y, s } = viewRef.current;
        const world = worldRef.current;
        const level = viewLevel(s, isFarRef.current);
        const far = level !== 'near';
        levelRef.current = level;
        if (world) {
            world.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
            // Body text fades in steps toward far mode; a step changes only a few times in a sweep.
            const detail = detailOpacity(s);
            if (detail !== detailRef.current) {
                detailRef.current = detail;
                world.style.setProperty('--wg-detail', String(detail));
            }
            // The two views cross-fade in CSS; the HTML stops painting once the far canvas has faded in.
            if (far !== isFarRef.current) {
                isFarRef.current = far;
                world.classList.toggle('far', far);
                // Under reduced motion there is no fade, so the hidden canvas has nothing to follow.
                if (!far && !reducedMotion()) farFadeEndRef.current = performance.now() + CROSS_FADE_MS;
            }
        }
        if (far || performance.now() < farFadeEndRef.current) drawFar();
        const dots = dotsRef.current;
        if (dots) {
            // Below MIN_SCALE the dots would blur into a wash, so the grid steps up instead of shrinking further.
            let tile = 22 * s;
            while (tile < 22 * MIN_SCALE) tile *= 2;
            dots.style.backgroundSize = `${tile}px ${tile}px`;
            dots.style.backgroundPosition = `${x}px ${y}px`;
        }
        if (zoomRef.current) zoomRef.current.textContent = `${Math.round(s * 100)}%`;
    }, [drawFar]);

    // A changed graph (layout, folds) is redrawn at once when far mode is showing it.
    React.useLayoutEffect(() => {
        farDrawingRef.current = null;
        if (isFarRef.current) drawFar();
    }, [model, positions, foldedNodes, foldedGroups, scene, wires, drawFar]);

    // Wheel and pointer input can arrive several times a frame: the view is drawn once per frame.
    const scheduleApply = React.useCallback(() => {
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            apply();
        });
    }, [apply]);
    React.useEffect(
        () => () => {
            if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        },
        []
    );

    const stopFlight = () => {
        if (flightRef.current !== null) cancelAnimationFrame(flightRef.current);
        flightRef.current = null;
    };

    React.useEffect(() => {
        const forget = () => {
            rectRef.current = null;
            if (isFarRef.current) scheduleApply();
        };
        window.addEventListener('resize', forget);
        return () => window.removeEventListener('resize', forget);
    }, [scheduleApply]);

    const flyTo = React.useCallback(
        (target: View) => {
            stopFlight();
            if (reducedMotion()) {
                viewRef.current = target;
                apply();
                return;
            }
            const from = viewRef.current;
            const started = performance.now();
            const step = (now: number) => {
                const t = Math.min(1, (now - started) / FLY_MS);
                const k = easeOutCubic(t);
                viewRef.current = {
                    x: from.x + (target.x - from.x) * k,
                    y: from.y + (target.y - from.y) * k,
                    s: from.s + (target.s - from.s) * k,
                };
                apply();
                flightRef.current = t < 1 ? requestAnimationFrame(step) : null;
            };
            flightRef.current = requestAnimationFrame(step);
        },
        [apply]
    );

    const viewportSize = React.useCallback(() => {
        const rect = canvasRect();
        return { w: rect?.width || window.innerWidth, h: rect?.height || window.innerHeight };
    }, [canvasRect]);

    // Handlers read the latest drawing through a ref, so key and wheel listeners bind once.
    const bounds = React.useMemo(
        () => (positions ? boundsOf(model, positions, foldedNodes, foldedGroups, scene) : null),
        [model, positions, foldedNodes, foldedGroups, scene]
    );
    const latest = React.useRef({ positions, foldedNodes, foldedGroups, scene, bounds });
    React.useLayoutEffect(() => {
        latest.current = { positions, foldedNodes, foldedGroups, scene, bounds };
    });

    const fit = React.useCallback(() => {
        const { bounds: current } = latest.current;
        if (current) flyTo(fitView(current, viewportSize()));
    }, [flyTo, viewportSize]);

    // Zooming out stops where Fit would, for a graph too big for MIN_SCALE.
    const zoomFloorNow = React.useCallback(() => zoomFloor(latest.current.bounds, viewportSize()), [viewportSize]);

    const zoomBy = React.useCallback(
        (factor: number) => {
            stopFlight();
            const { w, h } = viewportSize();
            viewRef.current = zoomAt(viewRef.current, factor, w / 2, h / 2, zoomFloorNow());
            apply();
        },
        [apply, viewportSize, zoomFloorNow]
    );

    // Far mode shows no controls. Tabbing onto a node's or group's fold button there zooms in to it, so the
    // focused control and its title are on screen; screen readers already hear the title in its label.
    const handleWorldFocus = (event: React.FocusEvent<HTMLDivElement>) => {
        if (!isFarRef.current || !(event.target instanceof Element)) return;
        const current = latest.current;
        const nodeId = event.target.closest('[data-node-id]')?.getAttribute('data-node-id');
        const groupKey = event.target.closest('[data-group-key]')?.getAttribute('data-group-key');
        let box: Rect | null = null;
        const node = nodeId ? model.nodes.find((candidate) => candidate.id === nodeId) : undefined;
        const at = node ? current.positions?.get(node.id) : undefined;
        if (node && at) box = { x: at.x, y: at.y, w: node.width, h: nodeHeight(node, current.foldedNodes.has(node.id)) };
        const group = groupKey ? model.groups.find((candidate) => candidate.key === groupKey) : undefined;
        if (group) box = groupBox(group, current.foldedGroups.has(group.key));
        if (!box) return;
        const { w, h } = viewportSize();
        const top = box.h > h - 48 ? 24 - box.y : h / 2 - (box.y + box.h / 2);
        flyTo({ s: 1, x: w / 2 - (box.x + box.w / 2), y: top });
    };

    // First view once there is something to show; later layout switches glide and refit.
    const shownRef = React.useRef<Positions | null>(null);
    React.useLayoutEffect(() => {
        if (!positions || positions === shownRef.current) return;
        const previous = shownRef.current;
        shownRef.current = positions;
        if (!previous) {
            if (bounds) viewRef.current = startView(bounds, viewportSize());
            apply();
            return;
        }
        const world = worldRef.current;
        if (!world || reducedMotion()) {
            fit();
            return;
        }
        world.classList.add('moving');
        const timer = window.setTimeout(() => {
            world.classList.remove('moving');
            fit();
        }, MOVE_MS);
        return () => {
            window.clearTimeout(timer);
            world.classList.remove('moving');
        };
        // Runs when the positions change; folds alone never move the view.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [positions]);

    React.useEffect(() => stopFlight, []);

    const onCloseRef = React.useRef(onClose);
    React.useLayoutEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    // Keys the graph owns. Every other viewer key does nothing while it is open. It listens in the capture
    // phase and stops a key it handles, so no listener registered later (the viewer's) sees it too.
    React.useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target;
            if (target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)) return;
            const own = (action: () => void) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                action();
            };
            if (event.key === 'Escape') {
                own(() => onCloseRef.current());
                return;
            }
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key === 'f' || event.key === 'F') own(fit);
            else if (event.key === '+' || event.key === '=') own(() => zoomBy(1.2));
            else if (event.key === '-') own(() => zoomBy(1 / 1.2));
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [fit, zoomBy]);

    // The wheel zooms around the pointer; it needs a non-passive listener to keep the page still.
    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const handleWheel = (event: WheelEvent) => {
            event.preventDefault();
            stopFlight();
            const rect = canvasRect();
            const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.012 : 0.0016));
            viewRef.current = zoomAt(
                viewRef.current,
                factor,
                event.clientX - (rect?.left ?? 0),
                event.clientY - (rect?.top ?? 0),
                zoomFloorNow()
            );
            scheduleApply();
            setInteracted(true);
        };
        canvas.addEventListener('wheel', handleWheel, { passive: false });
        return () => canvas.removeEventListener('wheel', handleWheel);
    }, [canvasRect, scheduleApply, zoomFloorNow]);

    const dragRef = React.useRef<{ id: number; x: number; y: number; view: View; panning: boolean } | null>(null);
    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return;
        stopFlight();
        dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, view: viewRef.current, panning: false };
    };
    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.id !== event.pointerId) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (!drag.panning) {
            if (Math.hypot(dx, dy) < PAN_THRESHOLD) return;
            drag.panning = true;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            event.currentTarget.classList.add('panning');
            setInteracted(true);
        }
        viewRef.current = { ...drag.view, x: drag.view.x + dx, y: drag.view.y + dy };
        scheduleApply();
    };
    const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.id !== event.pointerId) return;
        dragRef.current = null;
        event.currentTarget.classList.remove('panning');
    };

    const toggleNode = React.useCallback((id: string) => {
        setFoldedNodes((current) => {
            const next = new Set(current);
            if (!next.delete(id)) next.add(id);
            return next;
        });
    }, []);
    React.useEffect(
        () => () => {
            for (const timer of foldTimersRef.current.values()) window.clearTimeout(timer);
        },
        []
    );
    const refocusGroupRef = React.useRef<string | null>(null);
    React.useLayoutEffect(() => {
        const key = refocusGroupRef.current;
        refocusGroupRef.current = null;
        if (key === null) return;
        const holder = Array.from(worldRef.current?.querySelectorAll<HTMLElement>('[data-group-key]') ?? []).find(
            (element) => element.dataset.groupKey === key && element.querySelector('.wg-cb')
        );
        holder?.querySelector<HTMLButtonElement>('.wg-cb')?.focus({ preventScroll: true });
    }, [foldedGroups]);
    // The box eases to its new size in CSS. Members fade toward it, staying mounted until they have, and the
    // rerouted wires fade back in once the fold has settled.
    const toggleGroup = (key: string) => {
        const group = model.groups.find((candidate) => candidate.key === key);
        const folding = !foldedGroups.has(key);
        // The fold button moves between the title pill and the folded box: focus follows it.
        if (document.activeElement?.closest('[data-group-key]')?.getAttribute('data-group-key') === key) refocusGroupRef.current = key;
        setFoldedGroups((current) => {
            const next = new Set(current);
            if (!next.delete(key)) next.add(key);
            return next;
        });
        const world = worldRef.current;
        if (!group || !world || reducedMotion()) return;
        const members = new Set(group.members.filter((id) => !scene.hiddenBy.has(id)));
        const motion: FoldMotion = folding
            ? { leaving: members, arriving: new Set() }
            : { leaving: new Set(), arriving: new Set(group.members) };
        setFoldMotions((current) => new Map(current).set(key, motion));
        world.classList.add('folding');
        const timers = foldTimersRef.current;
        const running = timers.get(key);
        if (running !== undefined) window.clearTimeout(running);
        timers.set(
            key,
            window.setTimeout(() => {
                timers.delete(key);
                if (timers.size === 0) world.classList.remove('folding');
                setFoldMotions((current) => {
                    const next = new Map(current);
                    next.delete(key);
                    return next;
                });
            }, FOLD_MS)
        );
    };
    const titleContent = (key: string, title: string, count: number | null, shut: boolean) => (
        <>
            <span className="wg-gt">{title}</span>
            {count === null ? null : <span className="wg-gn">{nodeCount(count)}</span>}
            <button
                type="button"
                className="wg-cb"
                aria-label={shut ? `Unfold group ${title}` : `Fold group ${title}`}
                aria-expanded={!shut}
                onClick={() => toggleGroup(key)}
            >
                <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
        </>
    );
    // A folded box, like a narrow pill, drops the count before it cuts the title.
    const foldedCount = (title: string, count: number): number | null => {
        const family = getComputedStyle(document.documentElement).fontFamily || 'sans-serif';
        return countFits(textWidth(title, 15, 700, family), textWidth(nodeCount(count), 11, 500, family), FOLDED_TITLE_ROOM) ? count : null;
    };
    // The pills draw over the nodes, so a title stays readable where nodes fill the band.
    const groupTitles = () =>
        model.groups.map((group) => {
            const placed = titleSlots.get(group.key);
            if (!placed) return null;
            const slot = placed.rect;
            // The title sizes to its text; only the group's right inset caps it. The measured slot.w places it, and
            // can fall a few pixels short (a web font still loading), which must not cut the title.
            const box = groupBox(group, false);
            const style = {
                transform: `translate(${slot.x}px, ${slot.y}px)`,
                maxWidth: box.x + box.w - TITLE_INSET - slot.x,
                '--gc': groupColour(group.color, palette),
            } as React.CSSProperties;
            return (
                <div key={`title-${group.key}`} className="wg-gtitle" style={style} data-group-key={group.key}>
                    {titleContent(group.key, group.title, placed.count ? group.members.length : null, false)}
                </div>
            );
        });

    // A modal layer: Tab stays inside it.
    const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const root = rootRef.current;
        if (event.key !== 'Tab' || !root) return;
        const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === root)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (active === last || active === root)) {
            event.preventDefault();
            first.focus();
        }
    };
    // A click on the canvas would leave focus on the page behind; the layer keeps it, so the trap still holds.
    const keepFocus = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.target instanceof Element && event.target.closest(FOCUSABLE)) return;
        rootRef.current?.focus({ preventScroll: true });
    };

    const hint =
        model.nodes.length === 0
            ? 'This level of the workflow has no nodes.'
            : layout === 'tidy' && tidy.status === 'pending'
              ? 'Laying out the workflow…'
              : layout === 'tidy' && tidy.status === 'failed'
                ? 'Ambit could not lay out this workflow.'
                : interacted
                  ? null
                  : !canShowSaved
                    ? 'Laid out by Ambit: this file has no positions.'
                    : 'Drag the empty space to move around · wheel to zoom';

    return (
        <div
            ref={rootRef}
            className={palette === 'familiar' ? 'wg-layer wire-familiar' : 'wg-layer'}
            role="dialog"
            aria-modal="true"
            aria-label="Workflow graph"
            tabIndex={-1}
            onKeyDown={trapTab}
            onPointerDown={keepFocus}
        >
            <header className="wg-appbar">
                <button ref={backRef} type="button" className="wg-tbtn" onClick={onClose}>
                    <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                    Back to image
                </button>
                <span className="wg-name" title={fileName}>
                    {fileName}
                </span>
                <span className="wg-badge">ComfyUI</span>
                {report.source === 'api_prompt' ? <span className="wg-badge">API prompt</span> : null}
                {report.truncated ? (
                    <span className="wg-badge" title="This workflow is larger than Ambit draws, so part of it is not shown.">
                        Partly shown
                    </span>
                ) : null}
                <span className="wg-count">
                    {model.nodes.length} nodes · {model.links.length} wires
                </span>
            </header>
            <div
                ref={canvasRef}
                className="wg-canvas"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
            >
                <div ref={dotsRef} className="wg-dots" />
                <div ref={worldRef} className="wg-world" data-testid="workflow-graph-world" onFocus={handleWorldFocus}>
                    {positions ? (
                        <>
                            <svg className="wg-wires" aria-hidden="true">
                                {wires.map((wire) => (
                                    <path
                                        key={wire.key}
                                        className={`wg-wire t-${wire.type}${wire.bypassed ? ' bypassed' : ''}`}
                                        d={wire.d}
                                    />
                                ))}
                            </svg>
                            {model.groups.map((group) => {
                                if (scene.hiddenGroups.has(group.key)) return null;
                                const shut = foldedGroups.has(group.key);
                                const box = groupBox(group, shut);
                                const style = {
                                    transform: `translate(${box.x}px, ${box.y}px)`,
                                    width: box.w,
                                    height: box.h,
                                    // In Familiar this is the file's own colour, checked to be plain hex: user content,
                                    // as docs/design-system.md "Exceptions" allows.
                                    '--gc': groupColour(group.color, palette),
                                } as React.CSSProperties;
                                return (
                                    <div
                                        key={group.key}
                                        className={shut ? 'wg-group shut' : 'wg-group'}
                                        style={style}
                                        data-group-key={group.key}
                                    >
                                        {shut ? (
                                            <>
                                                <div className="wg-gh">
                                                    {titleContent(
                                                        group.key,
                                                        group.title,
                                                        foldedCount(group.title, group.members.length),
                                                        true
                                                    )}
                                                </div>
                                                <span className="wg-gport" style={{ left: -5 }} />
                                                <span className="wg-gport" style={{ right: -5 }} />
                                            </>
                                        ) : null}
                                    </div>
                                );
                            })}
                            {model.nodes.map((node) => {
                                const at = positions.get(node.id);
                                const leaving = foldMotion.leaving.has(node.id);
                                if (!at || (scene.hiddenBy.has(node.id) && !leaving)) return null;
                                return (
                                    <GraphNode
                                        key={node.id}
                                        node={node}
                                        at={at}
                                        folded={foldedNodes.has(node.id)}
                                        motion={leaving ? 'leaving' : foldMotion.arriving.has(node.id) ? 'arriving' : null}
                                        onToggleFold={toggleNode}
                                    />
                                );
                            })}
                            {groupTitles()}
                        </>
                    ) : null}
                </div>
                <canvas ref={farRef} className="wg-farcanvas" aria-hidden="true" />
                {hint ? (
                    <div className="wg-hint wg-frost" role="status">
                        {hint}
                    </div>
                ) : null}
                <div className="wg-tb wg-frost bottom-left" role="toolbar" aria-label="View">
                    <button type="button" className="wg-tbtn" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
                        <Minus aria-hidden="true" className="h-4 w-4" />
                    </button>
                    <span ref={zoomRef} className="wg-zoomv">
                        100%
                    </span>
                    <button type="button" className="wg-tbtn" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>
                        <Plus aria-hidden="true" className="h-4 w-4" />
                    </button>
                    <span className="wg-sep" />
                    <button type="button" className="wg-tbtn" onClick={fit}>
                        <Maximize aria-hidden="true" className="h-3.5 w-3.5" />
                        Fit <kbd className="wg-kbd">F</kbd>
                    </button>
                    <span className="wg-sep" />
                    <div className="wg-seg" role="group" aria-label="Layout">
                        <span title={canShowSaved ? undefined : 'This file has no saved positions.'}>
                            <button
                                type="button"
                                aria-pressed={layout === 'saved'}
                                disabled={!canShowSaved}
                                onClick={() => setLayout('saved')}
                            >
                                As saved
                            </button>
                        </span>
                        <button type="button" aria-pressed={layout === 'tidy'} onClick={() => setLayout('tidy')}>
                            Tidy
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default WorkflowGraphView;
