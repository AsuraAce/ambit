import * as React from 'react';
import type { GraphModel, Positions } from './graphModel';
import type { LayoutInput, LayoutRequest, LayoutResponse } from './tidyLayout';

export const createLayoutWorker = (): Worker => new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });

export const layoutInputFor = (model: GraphModel): LayoutInput => ({
    nodes: model.nodes.map((node) => ({ id: node.id, width: node.width, height: node.height })),
    edges: model.links.map((link) => ({ from: link.from, to: link.to })),
});

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
            done = true;
            setResult(next);
            worker.terminate();
        };
        worker.onmessage = (event: MessageEvent<LayoutResponse>) => {
            const response = event.data;
            if (response.requestId !== requestId) return;
            finish(
                'error' in response
                    ? { positions: null, failed: true }
                    : { positions: new Map(Object.entries(response.positions)), failed: false }
            );
        };
        worker.onerror = () => finish({ positions: null, failed: true });
        const request: LayoutRequest = { requestId, input: layoutInputFor(model) };
        worker.postMessage(request);
        return () => {
            // Stopped before it answered (unmount, or a development double mount): a later run starts again.
            if (!done) startedRef.current = false;
            worker.terminate();
        };
        // The model is fixed for the view's life: the view remounts for another item.
    }, [wanted, model, makeWorker]);

    const status: TidyStatus = result.positions ? 'ready' : result.failed ? 'failed' : wanted ? 'pending' : 'idle';
    return { status, positions: result.positions };
};
