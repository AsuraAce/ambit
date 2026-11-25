import * as React from 'react';
import { ArrowLeft, ChevronDown, Maximize, Minus, Plus } from 'lucide-react';
import type { WorkflowCanvasReport } from '../../../bindings';
import { useWorkflowGraphStore } from '../../../stores/workflowGraphStore';
import { buildGraphModel, hasSavedPositions, savedPositions, type Positions } from './graphModel';
import {
    boundsOf,
    FAR_SCALE,
    fitView,
    groupBox,
    sceneFor,
    startView,
    wirePaths,
    zoomAt,
    type LayoutMode,
    type View,
    type WireShape,
} from './geometry';
import { groupColour, type Palette } from './groupColour';
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
const PAN_THRESHOLD = 3;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

    const scene = React.useMemo(() => sceneFor(model, shownLayout, foldedGroups), [model, shownLayout, foldedGroups]);
    const wires = React.useMemo(
        () => (positions ? wirePaths(model, positions, foldedNodes, scene, shape) : []),
        [model, positions, foldedNodes, scene, shape]
    );

    const rootRef = React.useRef<HTMLDivElement>(null);
    const backRef = React.useRef<HTMLButtonElement>(null);
    const canvasRef = React.useRef<HTMLDivElement>(null);
    const worldRef = React.useRef<HTMLDivElement>(null);
    const dotsRef = React.useRef<HTMLDivElement>(null);
    const zoomRef = React.useRef<HTMLSpanElement>(null);
    const viewRef = React.useRef<View>({ x: 0, y: 0, s: 1 });
    const flightRef = React.useRef<number | null>(null);

    // The graph owns the keyboard while it is open: the viewer and app shortcuts stand down.
    const setGraphOpen = useWorkflowGraphStore((state) => state.setOpen);
    React.useEffect(() => {
        setGraphOpen(true);
        backRef.current?.focus();
        return () => setGraphOpen(false);
    }, [setGraphOpen]);

    // Pan and zoom never re-render React: one transform on the world, the dot grid and the readout.
    const apply = React.useCallback(() => {
        const { x, y, s } = viewRef.current;
        const world = worldRef.current;
        if (world) {
            world.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
            const far = s < FAR_SCALE;
            world.classList.toggle('far', far);
            world.style.setProperty('--inv', far ? String(1 / s) : '1');
        }
        const dots = dotsRef.current;
        if (dots) {
            dots.style.backgroundSize = `${22 * s}px ${22 * s}px`;
            dots.style.backgroundPosition = `${x}px ${y}px`;
        }
        if (zoomRef.current) zoomRef.current.textContent = `${Math.round(s * 100)}%`;
    }, []);

    const stopFlight = () => {
        if (flightRef.current !== null) cancelAnimationFrame(flightRef.current);
        flightRef.current = null;
    };

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

    const viewportSize = () => {
        const rect = canvasRef.current?.getBoundingClientRect();
        return { w: rect?.width || window.innerWidth, h: rect?.height || window.innerHeight };
    };

    // Handlers read the latest drawing through a ref, so key and wheel listeners bind once.
    const latest = React.useRef({ positions, foldedNodes, foldedGroups, scene });
    React.useLayoutEffect(() => {
        latest.current = { positions, foldedNodes, foldedGroups, scene };
    });

    const fit = React.useCallback(() => {
        const current = latest.current;
        if (!current.positions) return;
        const bounds = boundsOf(model, current.positions, current.foldedNodes, current.foldedGroups, current.scene);
        if (bounds) flyTo(fitView(bounds, viewportSize()));
    }, [flyTo, model]);

    const zoomBy = React.useCallback(
        (factor: number) => {
            stopFlight();
            const { w, h } = viewportSize();
            viewRef.current = zoomAt(viewRef.current, factor, w / 2, h / 2);
            apply();
        },
        [apply]
    );

    // First view once there is something to show; later layout switches glide and refit.
    const shownRef = React.useRef<Positions | null>(null);
    React.useLayoutEffect(() => {
        if (!positions || positions === shownRef.current) return;
        const previous = shownRef.current;
        shownRef.current = positions;
        const bounds = boundsOf(model, positions, foldedNodes, foldedGroups, scene);
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

    // Keys the graph owns. Every other viewer key does nothing while it is open.
    React.useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target;
            if (target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key === 'f' || event.key === 'F') {
                event.preventDefault();
                fit();
            } else if (event.key === '+' || event.key === '=') {
                event.preventDefault();
                zoomBy(1.2);
            } else if (event.key === '-') {
                event.preventDefault();
                zoomBy(1 / 1.2);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [fit, zoomBy]);

    // The wheel zooms around the pointer; it needs a non-passive listener to keep the page still.
    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const handleWheel = (event: WheelEvent) => {
            event.preventDefault();
            stopFlight();
            const rect = canvas.getBoundingClientRect();
            const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.012 : 0.0016));
            viewRef.current = zoomAt(viewRef.current, factor, event.clientX - rect.left, event.clientY - rect.top);
            apply();
            setInteracted(true);
        };
        canvas.addEventListener('wheel', handleWheel, { passive: false });
        return () => canvas.removeEventListener('wheel', handleWheel);
    }, [apply]);

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
        apply();
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
    const toggleGroup = (key: string) => {
        setFoldedGroups((current) => {
            const next = new Set(current);
            if (!next.delete(key)) next.add(key);
            return next;
        });
    };

    // A modal layer: Tab stays inside it.
    const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Tab' || !rootRef.current) return;
        const items = Array.from(rootRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    const hint =
        layout === 'tidy' && tidy.status === 'pending'
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
            onKeyDown={trapTab}
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
                <div ref={worldRef} className="wg-world" data-testid="workflow-graph-world">
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
                                    <div key={group.key} className={shut ? 'wg-group shut' : 'wg-group'} style={style}>
                                        <div className="wg-gh">
                                            <span className="wg-gt">{group.title}</span>
                                            <span className="wg-gn">{group.members.length} nodes</span>
                                            <button
                                                type="button"
                                                className="wg-cb"
                                                aria-label={shut ? `Unfold group ${group.title}` : `Fold group ${group.title}`}
                                                aria-expanded={!shut}
                                                onClick={() => toggleGroup(group.key)}
                                            >
                                                <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                        {shut ? (
                                            <>
                                                <span className="wg-gport" style={{ left: -5 }} />
                                                <span className="wg-gport" style={{ right: -5 }} />
                                            </>
                                        ) : null}
                                    </div>
                                );
                            })}
                            {model.nodes.map((node) => {
                                const at = positions.get(node.id);
                                if (!at || scene.hiddenBy.has(node.id)) return null;
                                return (
                                    <GraphNode
                                        key={node.id}
                                        node={node}
                                        at={at}
                                        folded={foldedNodes.has(node.id)}
                                        onToggleFold={toggleNode}
                                    />
                                );
                            })}
                        </>
                    ) : null}
                </div>
                {hint ? (
                    <div className="wg-hint wg-frost" role="status">
                        {hint}
                    </div>
                ) : null}
                <div className="wg-tb wg-frost bottom-left" role="toolbar" aria-label="View">
                    <button type="button" className="wg-tbtn" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
                        <Minus aria-hidden="true" className="h-4 w-4" />
                    </button>
                    <span ref={zoomRef} className="wg-zoomv" aria-label="Zoom level">
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
