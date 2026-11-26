import * as React from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Maximize, Minus, Plus } from 'lucide-react';
import type { WorkflowCanvasLevel, WorkflowCanvasReport } from '../../../bindings';
import { useWorkflowGraphStore } from '../../../stores/workflowGraphStore';
import { buildGraphModel, hasSavedPositions, savedPositions, type Positions } from './graphModel';
import {
    boundsOf,
    DETAIL_STEPS,
    detailOpacity,
    FAR_EXIT_SCALE,
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
    type WirePath,
    type WireShape,
} from './geometry';
import { FOLDED_GROUP_W } from './graphModel';
import { countFits, placeGroupTitle, TITLE_CHROME, TITLE_INSET } from './groupTitles';
import { groupColour, type Palette } from './groupColour';
import {
    drawFarScene,
    farNodeAt,
    farSceneFor,
    groupPillAt,
    NO_FAR_MARKS,
    prepareFarDrawing,
    readFarPalette,
    type FarDrawing,
    type FarMarks,
    type GroupLabel,
} from './farCanvas';
import { GraphNode } from './GraphNode';
import { GraphSearch } from './GraphSearch';
import { nextNode, searchGraph, type NavDirection } from './graphReading';
import { NodePanel } from './NodePanel';
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
    /** The wires as drawn just before the fold, by key. */
    wiresBefore: ReadonlyMap<string, WirePath>;
    /** The wires' keys in the order their elements stood in the DOM when the fold began. */
    order: readonly string[];
}

/** Two paths with the same command list, which CSS can ease one into the other. */
const sameShape = (a: string, b: string) => a.replace(/[^A-Za-z]/g, '') === b.replace(/[^A-Za-z]/g, '');

/**
 * How a wire moves during a fold. One the fold reroutes eases to its new route when the two routes share a shape,
 * and fades in on its new route when they do not; a wire new to the view fades in; one the fold tucks away fades out
 * with the members. Every other wire stays as it is.
 */
type WireMotion = 'morph' | 'arriving' | 'leaving' | null;
const wireMotion = (wire: WirePath, before: WirePath | undefined, folding: boolean): WireMotion => {
    if (!folding || before?.d === wire.d) return null;
    if (!before) return 'arriving';
    return sameShape(before.d, wire.d) ? 'morph' : 'arriving';
};

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** The side panel's width; flying to a node centres it in the room the panel leaves. */
const PANEL_W = 340;
/** How far inside the view's edges the arrow keys keep their node. */
const REVEAL_MARGIN = 40;

const ARROWS: Record<string, NavDirection> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const NOTHING_THAT_WAY: Record<NavDirection, string> = {
    left: 'No node to the left',
    right: 'No node to the right',
    up: 'No node above',
    down: 'No node below',
};

/** One level's state, kept while the graph is open so going back up a level returns to it as it was. */
interface LevelSnapshot {
    layout: LayoutMode;
    foldedNodes: ReadonlySet<string>;
    foldedGroups: ReadonlySet<string>;
    view: View;
    /** The Tidy layout, once worked out: coming back uses it as it is, with no new run and no glide. */
    tidyPositions: Positions | null;
}

/** How a level was reached, which decides where focus starts: the Back button, the canvas, or the layer. */
type LevelEntry = 'first' | 'keyboard' | 'pointer';

interface Crumb {
    key: string;
    name: string;
    level: WorkflowCanvasLevel;
}

interface GraphLevelProps {
    report: WorkflowCanvasReport;
    level: WorkflowCanvasLevel;
    crumbs: Crumb[];
    /** The node ids of the image's output nodes on this level. */
    outputIds: readonly string[];
    fileName: string;
    entry: LevelEntry;
    /** The node the arrow keys start on: the subgraph instance just left, on the way back up. */
    startAt: string | undefined;
    snapshot: LevelSnapshot | undefined;
    onSnapshot: (snapshot: LevelSnapshot) => void;
    canOpen: (node: { kind: string; subgraphId: string | null }) => boolean;
    onOpenSubgraph: (id: string, entry: LevelEntry) => void;
    onGoToDepth: (depth: number, entry: LevelEntry) => void;
    onClose: () => void;
    makeLayoutWorker: () => Worker;
}

/** One level of the graph: the root workflow, or a subgraph's definition. */
const GraphLevel: React.FC<GraphLevelProps> = ({
    report,
    level: canvasLevel,
    crumbs,
    outputIds,
    fileName,
    entry,
    startAt,
    snapshot,
    onSnapshot,
    canOpen,
    onOpenSubgraph,
    onGoToDepth,
    onClose,
    makeLayoutWorker,
}) => {
    const model = React.useMemo(() => buildGraphModel(canvasLevel), [canvasLevel]);
    const depth = crumbs.length - 1;
    const canShowSaved = report.hasSavedLayout && hasSavedPositions(model);
    const saved = React.useMemo(() => (canShowSaved ? savedPositions(model) : null), [canShowSaved, model]);
    const [layout, setLayout] = React.useState<LayoutMode>(() => snapshot?.layout ?? (canShowSaved ? 'saved' : 'tidy'));
    const tidy = useTidyPositions(model, layout === 'tidy', makeLayoutWorker, snapshot?.tidyPositions ?? null);
    // While Tidy is being worked out, the saved layout stays on screen.
    const positions: Positions | null = layout === 'tidy' ? (tidy.positions ?? saved) : saved;
    const shownLayout: LayoutMode = layout === 'tidy' && tidy.positions ? 'tidy' : saved ? 'saved' : 'tidy';

    const [foldedNodes, setFoldedNodes] = React.useState<ReadonlySet<string>>(
        () => snapshot?.foldedNodes ?? new Set(model.nodes.filter((node) => node.collapsed).map((node) => node.id))
    );
    const [foldedGroups, setFoldedGroups] = React.useState<ReadonlySet<string>>(() => snapshot?.foldedGroups ?? new Set());
    // The node in the side panel; the arrow keys' node, shown while the canvas has keyboard focus; the search.
    const [selected, setSelected] = React.useState<string | null>(null);
    const [cursor, setCursor] = React.useState<string | null>(startAt ?? null);
    const [canvasFocused, setCanvasFocused] = React.useState(false);
    const [announcement, setAnnouncement] = React.useState('');
    const [query, setQuery] = React.useState('');
    const hits = React.useMemo(() => searchGraph(model, query), [model, query]);
    const searchRef = React.useRef<HTMLInputElement>(null);
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
        // The oldest fold's picture of a wire wins: that is where the wire was last at rest.
        const wiresBefore = new Map<string, WirePath>();
        // The newest fold's order is the DOM's order now (toggleGroup re-inserts a fold's motion, so it is the last).
        let order: readonly string[] = [];
        for (const motion of foldMotions.values()) {
            for (const id of motion.leaving) leaving.add(id);
            for (const id of motion.arriving) arriving.add(id);
            for (const [key, wire] of motion.wiresBefore) if (!wiresBefore.has(key)) wiresBefore.set(key, wire);
            order = motion.order;
        }
        return { leaving, arriving, wiresBefore, order };
    }, [foldMotions]);
    const scene = React.useMemo(() => sceneFor(model, shownLayout, foldedGroups), [model, shownLayout, foldedGroups]);
    const wires = React.useMemo(
        () => (positions ? wirePaths(model, positions, foldedNodes, scene, shape) : []),
        [model, positions, foldedNodes, scene, shape]
    );
    // During a fold the wires it moves ease or fade, and the ones it tucks away stay drawn while they fade out. One
    // list, so a wire keeps its element as it goes from drawn to leaving. Every element already drawn keeps its place
    // in the DOM until the fold ends, as Chromium cancels the transition of an element that moves; new wires go last.
    const shownWires = React.useMemo(() => {
        const folding = foldMotions.size > 0;
        const shown = wires.map((wire) => ({ wire, motion: wireMotion(wire, foldMotion.wiresBefore.get(wire.key), folding) }));
        if (!folding) return shown;
        const byKey = new Map(shown.map((entry) => [entry.wire.key, entry]));
        for (const [key, wire] of foldMotion.wiresBefore) if (!byKey.has(key)) byKey.set(key, { wire, motion: 'leaving' });
        const ordered = foldMotion.order.flatMap((key) => byKey.get(key) ?? []);
        const placed = new Set(foldMotion.order);
        for (const [key, entry] of byKey) if (!placed.has(key)) ordered.push(entry);
        return ordered;
    }, [wires, foldMotions, foldMotion]);

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
    // The title pills the far canvas drew last, for clicks and hover, and the group whose pill the pointer is over.
    const farPillsRef = React.useRef<GroupLabel[]>([]);
    const hoverPillRef = React.useRef<string | null>(null);
    const farMarksRef = React.useRef<FarMarks>(NO_FAR_MARKS);
    const farInputs = React.useRef({ model, positions, foldedNodes, foldedGroups, scene, wires });
    React.useLayoutEffect(() => {
        farInputs.current = { model, positions, foldedNodes, foldedGroups, scene, wires };
    });

    React.useEffect(() => {
        if (entry === 'first') backRef.current?.focus();
        else if (entry === 'keyboard') canvasRef.current?.focus({ preventScroll: true });
        else rootRef.current?.focus({ preventScroll: true });
        // Where focus starts is decided once, when the level opens.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const snapshotRef = React.useRef({ layout, foldedNodes, foldedGroups, tidyPositions: tidy.positions, onSnapshot });
    React.useLayoutEffect(() => {
        snapshotRef.current = { layout, foldedNodes, foldedGroups, tidyPositions: tidy.positions, onSnapshot };
    });
    React.useEffect(
        () => () => {
            const { onSnapshot: keep, ...state } = snapshotRef.current;
            keep({ ...state, view: viewRef.current });
        },
        []
    );

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
        farPillsRef.current = drawFarScene(
            ctx,
            drawing,
            viewRef.current,
            dpr,
            levelRef.current === 'overview' ? 'overview' : 'far',
            hoverPillRef.current,
            farMarksRef.current
        );
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
                // A data attribute, not a custom property: an inherited property restyles all ~11k elements of a
                // 500-node graph (about 34 ms a step), the attribute only the body rows its rules match (about 9 ms).
                world.dataset.detail = String(Math.round(detail * DETAIL_STEPS));
            }
            // The two views cross-fade in CSS; the HTML stops painting once the far canvas has faded in.
            if (far !== isFarRef.current) {
                isFarRef.current = far;
                world.classList.toggle('far', far);
                // The HTML is unseen outside near view, so it leaves the Tab order; focus in it moves to the canvas.
                world.toggleAttribute('inert', far);
                if (far && world.contains(document.activeElement)) canvasRef.current?.focus({ preventScroll: true });
                // Near mode has HTML pills with their own hover, so a canvas pill's hover ends with far mode.
                hoverPillRef.current = null;
                canvasRef.current?.classList.remove('on-pill');
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

    // The far canvas rings the picked node, the arrow keys' node and a search's hits.
    React.useLayoutEffect(() => {
        farMarksRef.current = { selected, cursor: canvasFocused ? cursor : null, hits: hits?.ids ?? null };
        if (isFarRef.current) drawFar();
    }, [selected, cursor, canvasFocused, hits, drawFar]);

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

    // A group's title pill flies the view to fit that group, as Fit does the whole graph.
    const zoomToGroup = React.useCallback(
        (key: string) => {
            const group = model.groups.find((candidate) => candidate.key === key);
            if (!group) return;
            flyTo(fitView(groupBox(group, latest.current.foldedGroups.has(key)), viewportSize()));
            setInteracted(true);
        },
        [model, flyTo, viewportSize]
    );

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

    // First view once there is something to show; later layout switches glide and refit.
    const shownRef = React.useRef<Positions | null>(null);
    React.useLayoutEffect(() => {
        if (!positions || positions === shownRef.current) return;
        const previous = shownRef.current;
        shownRef.current = positions;
        if (!previous) {
            if (snapshot) viewRef.current = snapshot.view;
            else if (bounds) viewRef.current = startView(bounds, viewportSize());
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

    // Escape steps back one thing at a time: the search, the side panel, the subgraph level, then the graph.
    const escape = () => {
        if (query !== '') setQuery('');
        else if (selected !== null) setSelected(null);
        else if (depth > 0) onGoToDepth(depth - 1, 'keyboard');
        else onClose();
    };
    const escapeRef = React.useRef(escape);
    React.useLayoutEffect(() => {
        escapeRef.current = escape;
    });

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
                own(() => escapeRef.current());
                return;
            }
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key === '/') own(() => searchRef.current?.focus());
            else if (event.key === 'f' || event.key === 'F') own(fit);
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

    // Reading the graph: the side panel, the search and the arrow keys.
    const drawnRect = (id: string): Rect | null => {
        const current = latest.current;
        const node = model.byId.get(id);
        const at = current.positions?.get(id);
        if (!node || !at || current.scene.hiddenBy.has(id)) return null;
        return { x: at.x, y: at.y, w: node.width, h: nodeHeight(node, current.foldedNodes.has(id)) };
    };
    const drawnRects = (): Map<string, Rect> => {
        const rects = new Map<string, Rect>();
        for (const node of model.nodes) {
            const rect = drawnRect(node.id);
            if (rect) rects.set(node.id, rect);
        }
        return rects;
    };
    // Where the arrow keys start: the picked node, the last one, the image's output, else the top-left node.
    const startNode = (rects: ReadonlyMap<string, Rect>): string | null => {
        for (const id of [cursor, selected, ...outputIds]) if (id !== null && rects.has(id)) return id;
        let first: [string, Rect] | null = null;
        for (const entry of rects)
            if (!first || entry[1].y < first[1].y || (entry[1].y === first[1].y && entry[1].x < first[1].x)) first = entry;
        return first?.[0] ?? null;
    };
    // The room the side panel leaves, while it is open.
    const roomWidth = (w: number, panel: boolean) => (panel ? Math.max(w - PANEL_W, w / 2) : w);
    const flyToNode = (id: string) => {
        const rect = drawnRect(id);
        if (!rect) return;
        const { w, h } = viewportSize();
        const s = viewRef.current.s < FAR_EXIT_SCALE ? 1 : viewRef.current.s;
        flyTo({ s, x: roomWidth(w, true) / 2 - (rect.x + rect.w / 2) * s, y: h / 2 - (rect.y + rect.h / 2) * s });
        setInteracted(true);
    };
    // Pans, at the same zoom, just enough to bring a node inside the view's margins.
    const reveal = (id: string) => {
        const rect = drawnRect(id);
        if (!rect) return;
        const { x, y, s } = viewRef.current;
        const { w, h } = viewportSize();
        const shift = (start: number, size: number, offset: number, room: number) => {
            const near = start * s + offset;
            const far = (start + size) * s + offset;
            if (far - near > room - 2 * REVEAL_MARGIN) return REVEAL_MARGIN - start * s;
            if (near < REVEAL_MARGIN) return offset + REVEAL_MARGIN - near;
            if (far > room - REVEAL_MARGIN) return offset - (far - (room - REVEAL_MARGIN));
            return offset;
        };
        const next = { s, x: shift(rect.x, rect.w, x, roomWidth(w, selected !== null)), y: shift(rect.y, rect.h, y, h) };
        if (next.x !== x || next.y !== y) flyTo(next);
    };
    const select = (id: string) => {
        setSelected(id);
        setCursor(id);
    };
    // A node folded away inside a group is unfolded first, then the view flies to it once it is drawn.
    const pendingFlyRef = React.useRef<string | null>(null);
    const goTo = (id: string) => {
        select(id);
        if (latest.current.scene.hiddenBy.has(id)) {
            pendingFlyRef.current = id;
            setFoldedGroups((current) => {
                const next = new Set(current);
                for (const group of model.groups) if (group.members.includes(id)) next.delete(group.key);
                return next;
            });
            return;
        }
        flyToNode(id);
    };
    React.useLayoutEffect(() => {
        const id = pendingFlyRef.current;
        if (id === null || !drawnRect(id)) return;
        pendingFlyRef.current = null;
        flyToNode(id);
    });
    const announceNode = (id: string) => {
        const node = model.byId.get(id);
        if (node) setAnnouncement(`${node.title}, ${node.nodeType}`);
    };
    const openFromPointer = React.useCallback((id: string) => onOpenSubgraph(id, 'pointer'), [onOpenSubgraph]);
    const handleCanvasFocus = (event: React.FocusEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget) return;
        setCanvasFocused(true);
        const id = startNode(drawnRects());
        if (id === null) {
            setAnnouncement('This level has no nodes.');
            return;
        }
        setCursor(id);
        announceNode(id);
        reveal(id);
    };
    const handleCanvasBlur = (event: React.FocusEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) setCanvasFocused(false);
    };
    // Arrow keys and Enter on the canvas, or on the layer after a click: the first press from the layer only moves
    // focus to the canvas, which shows where the arrows are.
    const handleNavKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const canvas = canvasRef.current;
        if (!canvas || (event.target !== rootRef.current && event.target !== canvas)) return;
        const direction = ARROWS[event.key];
        if ((!direction && event.key !== 'Enter') || event.ctrlKey || event.metaKey || event.altKey) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.target !== canvas) {
            canvas.focus({ preventScroll: true });
            return;
        }
        const rects = drawnRects();
        const from = startNode(rects);
        if (from === null) return;
        if (direction) {
            const next = nextNode(model, rects, from, direction);
            if (next === null) {
                setCursor(from);
                setAnnouncement(NOTHING_THAT_WAY[direction]);
                return;
            }
            setCursor(next);
            announceNode(next);
            reveal(next);
            return;
        }
        const node = model.byId.get(from);
        if (!node) return;
        // On a subgraph, the first Enter shows its details (with Open), the second opens its level.
        if (canOpen(node) && selected === from) {
            onOpenSubgraph(from, 'keyboard');
            return;
        }
        select(from);
        setAnnouncement(canOpen(node) ? `${node.title} details. Enter again opens the subgraph.` : `${node.title} details`);
    };
    // Closing the panel or a search unmounts what had focus: the layer takes it back, so the keys still work.
    React.useLayoutEffect(() => {
        const root = rootRef.current;
        if (root && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
    }, [selected]);

    const dragRef = React.useRef<{ id: number; x: number; y: number; view: View; panning: boolean } | null>(null);
    // Whether the last press ended a pan: the click that follows it is not a click on a pill.
    const pannedRef = React.useRef(false);
    // The far pill under the pointer, if any: the canvas has no elements to hover, so the view hit-tests its pills.
    const farPillUnder = (event: React.PointerEvent<HTMLDivElement>): string | null => {
        if (!isFarRef.current) return null;
        const rect = canvasRect();
        const { x, y, s } = viewRef.current;
        return groupPillAt(farPillsRef.current, (event.clientX - (rect?.left ?? 0) - x) / s, (event.clientY - (rect?.top ?? 0) - y) / s);
    };
    const setHoverPill = (canvas: HTMLElement, key: string | null) => {
        if (key === hoverPillRef.current) return;
        hoverPillRef.current = key;
        canvas.classList.toggle('on-pill', key !== null);
        if (isFarRef.current) drawFar();
    };
    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        // The title in a pill is a button too, but a drag that starts on it still pans.
        if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button:not(.wg-gt), input, [role="listbox"]')))
            return;
        pannedRef.current = false;
        stopFlight();
        dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, view: viewRef.current, panning: false };
    };
    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.id !== event.pointerId) {
            if (event.pointerType !== 'touch') setHoverPill(event.currentTarget, farPillUnder(event));
            return;
        }
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (!drag.panning) {
            if (Math.hypot(dx, dy) < PAN_THRESHOLD) return;
            drag.panning = true;
            pannedRef.current = true;
            setHoverPill(event.currentTarget, null);
            event.currentTarget.setPointerCapture?.(event.pointerId);
            event.currentTarget.classList.add('panning');
            setInteracted(true);
        }
        viewRef.current = { ...drag.view, x: drag.view.x + dx, y: drag.view.y + dy };
        scheduleApply();
    };
    const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (drag?.id !== event.pointerId) return;
        dragRef.current = null;
        event.currentTarget.classList.remove('panning');
        if (event.type !== 'pointerup' || drag.panning) return;
        // A press and release on a far pill, without a pan, zooms to its group; on a far node, it opens the node.
        if (isFarRef.current) {
            const key = farPillUnder(event);
            if (key) {
                zoomToGroup(key);
                return;
            }
            const rect = canvasRect();
            const { x, y, s } = viewRef.current;
            const id = farNodeAt(
                farDrawingRef.current?.sceneNodes ?? [],
                (event.clientX - (rect?.left ?? 0) - x) / s,
                (event.clientY - (rect?.top ?? 0) - y) / s
            );
            if (id) select(id);
            else setSelected(null);
            return;
        }
        if (!(event.target instanceof Element) || event.target.closest('.wg-gtitle, .wg-group.shut, .wg-tb, .wg-hint')) return;
        const id = event.target.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
        if (id) select(id);
        else setSelected(null);
    };
    // In near mode the pill is HTML: a click on it, away from its fold button, zooms to its group. The title is a
    // button, so Enter on it does the same (a click with no pointer press, detail 0, which no pan can precede).
    const clickPill = (event: React.MouseEvent<HTMLDivElement>, key: string) => {
        if (event.detail > 0 && pannedRef.current) return;
        if (event.target instanceof Element && event.target.closest('.wg-cb')) return;
        zoomToGroup(key);
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
    // The box eases to its new size in CSS. Members fade toward it, staying mounted until they have, and the wires the
    // fold touches ease to their new routes; every other wire stays drawn.
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
        // Under reduced motion everything, wires included, snaps to the new state.
        if (!group || reducedMotion()) return;
        const members = new Set(group.members.filter((id) => !scene.hiddenBy.has(id)));
        const wiresBefore = new Map(wires.map((wire) => [wire.key, wire]));
        const order = shownWires.map(({ wire }) => wire.key);
        const motion: FoldMotion = folding
            ? { leaving: members, arriving: new Set(), wiresBefore, order }
            : { leaving: new Set(), arriving: new Set(group.members), wiresBefore, order };
        // Re-inserted, not replaced, so the newest fold comes last.
        setFoldMotions((current) => {
            const next = new Map(current);
            next.delete(key);
            return next.set(key, motion);
        });
        const timers = foldTimersRef.current;
        const running = timers.get(key);
        if (running !== undefined) window.clearTimeout(running);
        timers.set(
            key,
            window.setTimeout(() => {
                timers.delete(key);
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
            {shut ? (
                <span className="wg-gt">{title}</span>
            ) : (
                <button type="button" className="wg-gt" aria-label={`Zoom to group ${title}`}>
                    {title}
                </button>
            )}
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
                <div
                    key={`title-${group.key}`}
                    className="wg-gtitle"
                    style={style}
                    data-group-key={group.key}
                    onClick={(event) => clickPill(event, group.key)}
                >
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
    // The canvas is a Tab stop for the arrow keys, but a click on it keeps focus on the layer, so no keyboard ring
    // shows for a pointer.
    const keepFocus = (event: React.PointerEvent<HTMLDivElement>) => {
        const owner = event.target instanceof Element ? event.target.closest(FOCUSABLE) : null;
        if (owner && owner !== canvasRef.current) return;
        rootRef.current?.focus({ preventScroll: true });
    };
    const keepCanvasUnfocused = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!(event.target instanceof Element && event.target.closest('input, button, select, textarea, [role="listbox"]'))) {
            event.preventDefault();
        }
    };
    const selectedNode = selected === null ? undefined : model.byId.get(selected);

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
            onKeyDown={(event) => {
                trapTab(event);
                handleNavKey(event);
            }}
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
                {depth > 0 ? (
                    <nav className="wg-crumbs" aria-label="Workflow levels">
                        {crumbs.map((crumb, index) =>
                            index < depth ? (
                                <React.Fragment key={crumb.key}>
                                    <button type="button" className="wg-crumb" onClick={() => onGoToDepth(index, 'pointer')}>
                                        {crumb.name}
                                    </button>
                                    <ChevronRight aria-hidden="true" className="h-3 w-3 flex-none" />
                                </React.Fragment>
                            ) : (
                                <span key={crumb.key} className="wg-crumb here" aria-current="location">
                                    {crumb.name}
                                </span>
                            )
                        )}
                    </nav>
                ) : null}
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
            <div className="wg-stage">
                <div
                    ref={canvasRef}
                    className="wg-canvas"
                    tabIndex={0}
                    role="application"
                    aria-label="Workflow canvas"
                    aria-describedby="wg-canvas-help"
                    onFocus={handleCanvasFocus}
                    onBlur={handleCanvasBlur}
                    onMouseDown={keepCanvasUnfocused}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onPointerLeave={(event) => setHoverPill(event.currentTarget, null)}
                >
                    <div ref={dotsRef} className="wg-dots" />
                    <span id="wg-canvas-help" className="wg-sr">
                        Arrow keys move between nodes: right and left follow the wires. Enter shows the node’s details.
                    </span>
                    <span className="wg-sr" aria-live="polite" data-testid="graph-announcer">
                        {announcement}
                    </span>
                    <div
                        ref={worldRef}
                        className="wg-world"
                        data-testid="workflow-graph-world"
                        // An attribute, not a class: apply() toggles classes on this element that a re-render must keep.
                        data-searching={hits ? '' : undefined}
                    >
                        {positions ? (
                            <>
                                <svg className="wg-wires" aria-hidden="true">
                                    {shownWires.map(({ wire, motion }) => (
                                        <path
                                            key={wire.key}
                                            className={`wg-wire t-${wire.type}${wire.bypassed ? ' bypassed' : ''}${motion ? ` ${motion}` : ''}`}
                                            d={wire.d}
                                            // CSS eases the d property, not the attribute: a morphing wire carries its route
                                            // in its style too, so the change from the old route is a transition.
                                            style={motion === 'morph' ? { d: `path("${wire.d}")` } : undefined}
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
                                            selected={selected === node.id}
                                            cursor={canvasFocused && cursor === node.id}
                                            found={hits ? (hits.ids.has(node.id) ? 'hit' : 'miss') : null}
                                            onToggleFold={toggleNode}
                                            onOpen={canOpen(node) ? openFromPointer : undefined}
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
                    <div className="wg-tb wg-frost top-left">
                        <GraphSearch
                            inputRef={searchRef}
                            query={query}
                            hits={hits}
                            onQuery={setQuery}
                            onPick={(id) => {
                                setQuery('');
                                goTo(id);
                                rootRef.current?.focus({ preventScroll: true });
                            }}
                            onDone={() => {
                                setQuery('');
                                rootRef.current?.focus({ preventScroll: true });
                            }}
                        />
                    </div>
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
                {selectedNode ? (
                    <NodePanel
                        model={model}
                        node={selectedNode}
                        folded={foldedNodes.has(selectedNode.id)}
                        onClose={() => setSelected(null)}
                        onGo={goTo}
                        onToggleFold={toggleNode}
                        onOpen={canOpen(selectedNode) ? openFromPointer : undefined}
                    />
                ) : null}
            </div>
        </div>
    );
};

/** The full-screen, read-only workflow graph. Rendered by WorkflowInspector, so the viewer's privacy gate unmounts it. */
const WorkflowGraphView: React.FC<WorkflowGraphViewProps> = ({ report, fileName, onClose, makeLayoutWorker = createLayoutWorker }) => {
    // The subgraph instances opened, outermost first; none at the workflow's own level. `from` is the instance just
    // left on the way back up, where the arrow keys start.
    const [path, setPath] = React.useState<{ ids: string[]; entry: LevelEntry; from?: string }>({ ids: [], entry: 'first' });
    // Written as a level closes and read as one opens; never a reason to re-render.
    const [snapshots] = React.useState(() => new Map<string, LevelSnapshot>());
    const definitions = React.useMemo(() => new Map(report.subgraphs.map((subgraph) => [subgraph.id, subgraph])), [report]);
    const canOpen = React.useCallback(
        (node: { kind: string; subgraphId: string | null }) =>
            node.kind === 'subgraph' && node.subgraphId !== null && definitions.has(node.subgraphId),
        [definitions]
    );
    const crumbs = React.useMemo(() => {
        const list: Crumb[] = [{ key: '', name: 'Workflow', level: report.root }];
        for (const id of path.ids) {
            const parent = list[list.length - 1];
            const instance = parent.level.nodes.find((node) => node.id === id);
            const definition = instance?.subgraphId ? definitions.get(instance.subgraphId) : undefined;
            if (!instance || !definition) break;
            list.push({
                key: `${parent.key}/${id}`,
                name: definition.name || instance.title || instance.nodeType,
                level: definition.level,
            });
        }
        return list;
    }, [report, definitions, path]);
    const current = crumbs[crumbs.length - 1];
    const depth = crumbs.length - 1;
    // Output paths are full paths: the instances, then the node.
    const outputIds = React.useMemo(() => {
        const ids = path.ids.slice(0, depth);
        return report.selectedOutputPaths
            .filter((outputPath) => outputPath.length === depth + 1 && ids.every((id, index) => outputPath[index] === id))
            .map((outputPath) => outputPath[depth]);
    }, [report, path, depth]);

    // The graph owns the keyboard while it is open: the viewer and app shortcuts stand down.
    const setGraphOpen = useWorkflowGraphStore((state) => state.setOpen);
    React.useEffect(() => {
        setGraphOpen(true);
        return () => setGraphOpen(false);
    }, [setGraphOpen]);

    const onSnapshot = React.useCallback((snapshot: LevelSnapshot) => snapshots.set(current.key, snapshot), [current.key, snapshots]);
    const onOpenSubgraph = React.useCallback(
        (id: string, entry: LevelEntry) => setPath((shown) => ({ ids: [...shown.ids.slice(0, depth), id], entry })),
        [depth]
    );
    const onGoToDepth = React.useCallback(
        (target: number, entry: LevelEntry) => setPath((shown) => ({ ids: shown.ids.slice(0, target), entry, from: shown.ids[target] })),
        []
    );

    return (
        <GraphLevel
            key={current.key}
            report={report}
            level={current.level}
            crumbs={crumbs}
            outputIds={outputIds}
            fileName={fileName}
            entry={path.entry}
            startAt={path.from}
            snapshot={snapshots.get(current.key)}
            onSnapshot={onSnapshot}
            canOpen={canOpen}
            onOpenSubgraph={onOpenSubgraph}
            onGoToDepth={onGoToDepth}
            onClose={onClose}
            makeLayoutWorker={makeLayoutWorker}
        />
    );
};

export default WorkflowGraphView;
