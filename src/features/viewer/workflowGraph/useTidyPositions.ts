import * as React from 'react';
import type { GraphModel, Positions } from './graphModel';
import type { LayoutInput, LayoutRequest, LayoutResponse } from './tidyLayout';

export const createLayoutWorker = (): Worker => new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });

/**
 * The worker sees each node by its index, never the file's id: an id such as `__proto__` would break the
 * layout's keyed objects, and file strings stay in the view.
 */
export const layoutInputFor = (model: GraphModel): LayoutInput => {
    const index = new Map(model.nodes.map((node, i) => [node.id, String(i)]));
    return {
        nodes: model.nodes.map((node, i) => ({ id: String(i), width: node.width, height: node.height })),
        edges: model.links.flatMap((link) => {
            const from = index.get(link.from);
            const to = index.get(link.to);
            return from !== undefined && to !== undefined ? [{ from, to }] : [];
        }),
    };
};

/** Maps the worker's index-keyed answer back to the file's node ids. */
export const positionsFromLayout = (model: GraphModel, laid: Record<string, { x: number; y: number }>): Positions => {
    const positions: Positions = new Map();
    model.nodes.forEach((node, i) => {
        const key = String(i);
        if (Object.prototype.hasOwnProperty.call(laid, key)) positions.set(node.id, laid[key]);
    });
    return positions;
};

/** A layout still running after this long is stopped, and the file's own positions stay on screen. */
export const LAYOUT_TIME_CAP_MS = 10_000;

export type TidyStatus = 'idle' | 'pending' | 'ready' | 'failed';

/** Lays the graph out in a worker once it is first wanted, and keeps the result while the view is open. */
export const useTidyPositions = (
    model: GraphModel,
    wanted: boolean,
    makeWorker: () => Worker = createLayoutWorker
): { status: TidyStatus; positions: Positions | null } => {
    const [result, setResult] = React.useState<{ positions: Positions | null; failed: boolean }>({ positions: null, failed: false });
    const startedRef = React.useRef(false);

    React.useEffect(() => {
        if (!wanted || startedRef.current) return;
        startedRef.current = true;
        let done = false;
        let worker: Worker;
        try {
            worker = makeWorker();
        } catch {
            done = true;
            queueMicrotask(() => setResult({ positions: null, failed: true }));
            return;
        }
        const requestId = 1;
        const finish = (next: { positions: Positions | null; failed: boolean }) => {
            if (done) return;
            done = true;
            window.clearTimeout(timer);
            setResult(next);
            worker.terminate();
        };
        const timer = window.setTimeout(() => finish({ positions: null, failed: true }), LAYOUT_TIME_CAP_MS);
        worker.onmessage = (event: MessageEvent<LayoutResponse>) => {
            const response = event.data;
            if (response.requestId !== requestId) return;
            finish(
                'error' in response
                    ? { positions: null, failed: true }
                    : { positions: positionsFromLayout(model, response.positions), failed: false }
            );
        };
        worker.onerror = () => finish({ positions: null, failed: true });
        const request: LayoutRequest = { requestId, input: layoutInputFor(model) };
        worker.postMessage(request);
        return () => {
            window.clearTimeout(timer);
            // Stopped before it answered (unmount, or a development double mount): a later run starts again.
            if (!done) startedRef.current = false;
            worker.terminate();
        };
        // The model is fixed for the view's life: the view remounts for another item.
    }, [wanted, model, makeWorker]);

    const status: TidyStatus = result.positions ? 'ready' : result.failed ? 'failed' : wanted ? 'pending' : 'idle';
    return { status, positions: result.positions };
};
