// Hands files dropped onto the window to Rust (#493). Native drop stays off so the
// app's own drag-and-drop keeps working; WebView2 instead passes each dropped File
// to Rust with its path, which page script cannot set. Rust grants what it can and
// answers with a `library-drop-result` event carrying the same drop id.
//
// The message is a JSON string, not an object: wry's own message handler fails on
// anything but a string, and WebView2 then skips the handlers after it, Ambit's
// included. Tauri's IPC also reads the string; it is not a command, so Tauri only
// writes a parse error to the page console.

interface WebView2Bridge {
    postMessageWithAdditionalObjects?: (message: unknown, additionalObjects: ArrayLike<unknown>) => void;
}

type WindowWithWebView2 = Window & { chrome?: { webview?: WebView2Bridge } };

export const DROP_MESSAGE_TYPE = 'ambit-drop';

export type DropPost =
    | { status: 'posted'; dropId: string }
    /** WebView2 refuses a File with no file on disk behind it, such as an image dragged from a browser. */
    | { status: 'not-on-disk' }
    | { status: 'unavailable' };

let dropCount = 0;

const isNotOnDiskError = (error: unknown): boolean => error instanceof TypeError && /not a file on the disk/i.test(error.message);

/** Posts the dropped files to Rust, which answers with the same drop id. */
export const postDroppedFiles = (files: File[]): DropPost => {
    const bridge = (window as WindowWithWebView2).chrome?.webview;
    if (!bridge?.postMessageWithAdditionalObjects) return { status: 'unavailable' };
    dropCount += 1;
    const dropId = `drop-${Date.now()}-${dropCount}`;
    try {
        bridge.postMessageWithAdditionalObjects(JSON.stringify({ type: DROP_MESSAGE_TYPE, id: dropId }), files);
    } catch (error) {
        if (isNotOnDiskError(error)) return { status: 'not-on-disk' };
        console.error('[DropImport] WebView2 refused the dropped files', error);
        return { status: 'unavailable' };
    }
    return { status: 'posted', dropId };
};
