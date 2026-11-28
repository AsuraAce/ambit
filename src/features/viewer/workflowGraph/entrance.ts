import type { WirePath } from './geometry';

/*
 * The graph's entrance, from UX-L267: nodes fade and rise in from left to right, groups fade in, and each wire draws
 * itself once the nodes at its ends are arriving. It plays when a level opens; under reduced motion it does not.
 */

/** The whole stagger never runs longer than this, so a big graph arrives as fast as a small one. */
export const ENTRANCE_SPAN_CAP_MS = 620;
/** The gap between one node and the next, until the cap. */
export const ENTRANCE_STEP_MS = 32;
export const NODE_ARRIVE_MS = 380;
export const GROUP_ARRIVE_MS = 500;
export const WIRE_DRAW_MS = 520;
/** A wire starts this long after the later of its source and (less WIRE_LEAD_MS) its target. */
const WIRE_LAG_MS = 160;
const WIRE_LEAD_MS = 120;
/** Above this many wires on a level, the wires fade in rather than draw themselves. */
export const WIRE_DRAW_LIMIT = 300;
/** The far canvas staggers nodes and wires in at most this many steps, so a frame costs about one plain draw. */
export const ARRIVE_STEPS = 8;
export const NODE_ARRIVE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const WIRE_DRAW_EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';

export interface EntrancePlan {
    /** When each node starts, in ms from the start. */
    nodeDelay: ReadonlyMap<string, number>;
    /** How long the whole entrance runs, wires included. */
    end: number;
}

/** Orders the nodes left to right (then top to bottom, for a layout Ambit made) and spreads their starts. */
export const planEntrance = (nodes: readonly { id: string; x: number; y: number }[], byRows: boolean): EntrancePlan => {
    const order = [...nodes].sort((a, b) => a.x - b.x || (byRows ? a.y - b.y : 0));
    const span = Math.min(ENTRANCE_SPAN_CAP_MS, order.length * ENTRANCE_STEP_MS);
    const nodeDelay = new Map<string, number>();
    order.forEach((node, index) => nodeDelay.set(node.id, Math.round((index / Math.max(1, order.length - 1)) * span)));
    return { nodeDelay, end: Math.max(GROUP_ARRIVE_MS, span + NODE_ARRIVE_MS, span + WIRE_LAG_MS + WIRE_DRAW_MS) };
};

export const wireDelay = (plan: EntrancePlan, wire: Pick<WirePath, 'from' | 'to'>): number =>
    Math.max(plan.nodeDelay.get(wire.from) ?? 0, (plan.nodeDelay.get(wire.to) ?? 0) - WIRE_LEAD_MS) + WIRE_LAG_MS;

/** Which of the far canvas's steps a start falls in, and that step's own start. */
export const arriveStep = (delay: number, span: number): { step: number; delay: number } => {
    if (span <= 0) return { step: 0, delay: 0 };
    const step = Math.min(ARRIVE_STEPS - 1, Math.round((delay / span) * (ARRIVE_STEPS - 1)));
    return { step, delay: (step / (ARRIVE_STEPS - 1)) * span };
};

/** How far in something is at time t, eased out: 0 before its start, 1 once it has run its length. */
export const arrived = (t: number, delay: number, duration: number): number => {
    const p = Math.min(1, Math.max(0, (t - delay) / duration));
    return 1 - (1 - p) ** 4;
};
