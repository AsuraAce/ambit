import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import type { Rect, View } from './geometry';
import type { FarNode } from './farCanvas';
import { MAP_H, MAP_W, mapFit, mapPoint, viewCentredOn, viewOnMap } from './mapGeometry';

export interface MapGroup extends Rect {
    key: string;
    /** A CSS colour: plain hex, or var() of a token. */
    colour: string;
}

interface GraphMapProps {
    nodes: readonly FarNode[];
    groups: readonly MapGroup[];
    bounds: Rect | null;
    selected: string | null;
    open: boolean;
    onToggle: () => void;
    /** The view now, and the room it shows (the canvas less the side panel). */
    getView: () => View;
    getRoom: () => { w: number; h: number };
    onPan: (view: View) => void;
    /** Set by the map: the view calls it on every pan or zoom, and only the view rectangle redraws. */
    redrawRef: React.RefObject<(() => void) | null>;
}

const context = (canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null => {
    const ctx = canvas?.getContext('2d');
    // jsdom has no 2D canvas; the tests' stub has no drawing calls.
    return ctx && typeof ctx.fillRect === 'function' ? ctx : null;
};

/** The map: the whole level in the corner, with the part the view shows. A click or drag on it moves the view there. */
export const GraphMap: React.FC<GraphMapProps> = ({
    nodes,
    groups,
    bounds,
    selected,
    open,
    onToggle,
    getView,
    getRoom,
    onPan,
    redrawRef,
}) => {
    const rootRef = React.useRef<HTMLDivElement>(null);
    const baseRef = React.useRef<HTMLCanvasElement>(null);
    const viewRef = React.useRef<HTMLCanvasElement>(null);
    const fit = React.useMemo(() => (bounds ? mapFit(bounds) : null), [bounds]);
    // The rectangle's colours, read with the nodes', so a pan reads no styles.
    const viewColours = React.useRef({ fill: '', stroke: '' });

    const token = React.useCallback((name: string) => {
        const root = rootRef.current;
        return root ? getComputedStyle(root).getPropertyValue(name).trim() : '';
    }, []);
    const resolve = React.useCallback(
        (colour: string) => {
            const name = /^var\((--[\w-]+)\)$/.exec(colour)?.[1];
            return name ? token(name) : colour;
        },
        [token]
    );

    const drawView = React.useCallback(() => {
        const ctx = context(viewRef.current);
        if (!ctx) return;
        ctx.clearRect(0, 0, MAP_W, MAP_H);
        if (!fit) return;
        const rect = viewOnMap(getView(), getRoom(), fit);
        ctx.fillStyle = viewColours.current.fill;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.strokeStyle = viewColours.current.stroke;
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }, [fit, getView, getRoom]);

    // The nodes change rarely, so they are drawn once on their own canvas; a pan redraws only the rectangle, in the
    // view's own animation frame.
    React.useLayoutEffect(() => {
        if (!open) return;
        const ctx = context(baseRef.current);
        if (!ctx) return;
        viewColours.current = { fill: token('--graph-map-view-fill'), stroke: token('--graph-map-view') };
        ctx.clearRect(0, 0, MAP_W, MAP_H);
        if (!fit) return;
        const { k, ox, oy } = fit;
        ctx.globalAlpha = 0.19;
        for (const group of groups) {
            ctx.fillStyle = resolve(group.colour);
            ctx.fillRect(ox + group.x * k, oy + group.y * k, group.w * k, group.h * k);
        }
        const plain = token('--graph-map-node');
        const bypass = token('--graph-ember-deep');
        const sage = token('--graph-sage');
        for (const node of nodes) {
            const picked = node.id === selected;
            ctx.globalAlpha = node.variant === 'mute' && !picked ? 0.45 : 1;
            ctx.fillStyle = picked ? sage : node.variant === 'bypass' ? bypass : plain;
            ctx.fillRect(ox + node.x * k, oy + node.y * k, Math.max(3, node.w * k), Math.max(2, node.h * k));
        }
        ctx.globalAlpha = 1;
        drawView();
    }, [open, fit, groups, nodes, selected, resolve, token, drawView]);

    React.useLayoutEffect(() => {
        redrawRef.current = open ? drawView : null;
        return () => {
            redrawRef.current = null;
        };
    }, [redrawRef, drawView, open]);

    const dragRef = React.useRef<number | null>(null);
    const moveTo = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!fit) return;
        const point = mapPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
        onPan(viewCentredOn(point, fit, getView(), getRoom()));
    };

    return (
        <div ref={rootRef} className={open ? 'wg-map wg-frost' : 'wg-map wg-frost shut'}>
            <div className="wg-map-h">
                <span className="wg-cap">Map</span>
                <button
                    type="button"
                    className="wg-tbtn wg-map-fold"
                    aria-label={open ? 'Hide the map' : 'Show the map'}
                    aria-expanded={open}
                    title={open ? 'Hide the map (M)' : 'Show the map (M)'}
                    onClick={onToggle}
                >
                    <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
            </div>
            {open ? (
                <div className="wg-map-c">
                    <canvas ref={baseRef} width={MAP_W} height={MAP_H} aria-hidden="true" />
                    <canvas
                        ref={viewRef}
                        width={MAP_W}
                        height={MAP_H}
                        aria-hidden="true"
                        data-testid="graph-map"
                        // The map's own drag: the canvas under it must not start a pan of its own.
                        onPointerDown={(event) => {
                            if (event.button !== 0) return;
                            event.stopPropagation();
                            dragRef.current = event.pointerId;
                            event.currentTarget.setPointerCapture?.(event.pointerId);
                            moveTo(event);
                        }}
                        onPointerMove={(event) => {
                            if (dragRef.current === event.pointerId) moveTo(event);
                        }}
                        onPointerUp={(event) => {
                            event.stopPropagation();
                            if (dragRef.current === event.pointerId) dragRef.current = null;
                        }}
                        onPointerCancel={() => {
                            dragRef.current = null;
                        }}
                    />
                </div>
            ) : null}
        </div>
    );
};
