import { describe, expect, it } from 'vitest';
import {
    ARRIVE_STEPS,
    arrived,
    arriveStep,
    ENTRANCE_SPAN_CAP_MS,
    ENTRANCE_STEP_MS,
    NODE_ARRIVE_MS,
    planEntrance,
    WIRE_DRAW_MS,
    wireDelay,
} from '../entrance';

const row = (count: number) => Array.from({ length: count }, (_, index) => ({ id: String(index), x: index * 300, y: 0 }));

describe('planEntrance', () => {
    // The owner liked UX-L267's entrance: the graph reads in from left to right.
    it('starts the leftmost node first and each node after the ones to its left', () => {
        const nodes = [
            { id: 'right', x: 900, y: 0 },
            { id: 'left', x: 0, y: 0 },
            { id: 'middle', x: 400, y: 0 },
        ];
        const { nodeDelay } = planEntrance(nodes, false);
        expect(nodeDelay.get('left')).toBe(0);
        expect(nodeDelay.get('middle')!).toBeGreaterThan(0);
        expect(nodeDelay.get('right')!).toBeGreaterThan(nodeDelay.get('middle')!);
    });

    // A big graph must not keep the user waiting: the stagger is capped, so 500 nodes arrive as fast as 20.
    it('keeps the whole stagger inside the cap for a large graph, and short for a small one', () => {
        const large = planEntrance(row(500), false);
        expect(Math.max(...large.nodeDelay.values())).toBe(ENTRANCE_SPAN_CAP_MS);
        expect(large.end).toBeLessThan(1400);
        const small = planEntrance(row(4), false);
        expect(Math.max(...small.nodeDelay.values())).toBe(4 * ENTRANCE_STEP_MS);
        expect(small.end).toBeGreaterThanOrEqual(4 * ENTRANCE_STEP_MS + NODE_ARRIVE_MS);
    });

    it('orders a column top to bottom in a layout Ambit made', () => {
        const column = [
            { id: 'low', x: 0, y: 500 },
            { id: 'high', x: 0, y: 0 },
        ];
        const tidy = planEntrance(column, true).nodeDelay;
        expect(tidy.get('high')!).toBeLessThan(tidy.get('low')!);
    });
});

describe('wireDelay', () => {
    // A wire draws from its source, so it never starts before the node it leaves has started to arrive.
    it('starts after its source node, and no later than just before its target', () => {
        const plan = planEntrance(row(10), false);
        const wire = { from: '2', to: '7' };
        const delay = wireDelay(plan, wire);
        expect(delay).toBeGreaterThan(plan.nodeDelay.get('2')!);
        expect(delay + WIRE_DRAW_MS).toBeLessThanOrEqual(plan.end);
        const backward = wireDelay(plan, { from: '7', to: '2' });
        expect(backward).toBeGreaterThan(plan.nodeDelay.get('7')!);
    });
});

describe('arriveStep and arrived', () => {
    // The far canvas draws one layer per step, so a frame's cost stays near a plain draw however many nodes there are.
    it('puts every start in one of a few steps, none later than the start itself by more than a step', () => {
        const steps = new Set<number>();
        for (let delay = 0; delay <= 620; delay += 7) {
            const step = arriveStep(delay, 620);
            steps.add(step.step);
            expect(Math.abs(step.delay - delay)).toBeLessThanOrEqual(620 / (ARRIVE_STEPS - 1) / 2 + 1e-9);
        }
        expect(steps.size).toBe(ARRIVE_STEPS);
        expect(arriveStep(0, 0)).toEqual({ step: 0, delay: 0 });
    });

    it('is nothing before the start, all of it after its length, and eases out between', () => {
        expect(arrived(99, 100, 380)).toBe(0);
        expect(arrived(480, 100, 380)).toBe(1);
        expect(arrived(100 + 190, 100, 380)).toBeGreaterThan(0.5);
    });
});
