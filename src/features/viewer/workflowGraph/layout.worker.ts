import { handleLayoutRequest, type LayoutRequest } from './tidyLayout';

// dagre takes about 300 ms at 500 nodes, so it runs here, off the viewer's thread.
self.onmessage = (event: MessageEvent<LayoutRequest>) => {
    self.postMessage(handleLayoutRequest(event.data));
};
