import { afterEach, describe, expect, it, vi } from 'vitest';
import { DROP_MESSAGE_TYPE, postDroppedFiles } from '../dropImportService';

type BridgeWindow = Window & { chrome?: { webview?: { postMessageWithAdditionalObjects?: unknown } } };

const installBridge = (post: (message: unknown, files: ArrayLike<unknown>) => void) => {
    (window as BridgeWindow).chrome = { webview: { postMessageWithAdditionalObjects: post } };
};

describe('postDroppedFiles', () => {
    afterEach(() => {
        delete (window as BridgeWindow).chrome;
        vi.restoreAllMocks();
    });

    it('posts a string message, since wry drops the event for any other kind, with the files attached', () => {
        const post = vi.fn();
        installBridge(post);
        const files = [new File(['x'], 'a.png')];

        const result = postDroppedFiles(files);

        expect(result.status).toBe('posted');
        const [message, attached] = post.mock.calls[0] as [unknown, File[]];
        expect(typeof message).toBe('string');
        expect(JSON.parse(message as string)).toEqual({
            type: DROP_MESSAGE_TYPE,
            id: result.status === 'posted' ? result.dropId : undefined,
        });
        expect(attached).toBe(files);
    });

    it('reports a file WebView2 refuses because nothing on disk backs it', () => {
        installBridge(() => {
            throw new TypeError(
                "Failed to execute 'postMessageWithAdditionalObjects' on 'EmbeddedBrowserWebView': Failed to post a message: additional File object is not a file on the disk."
            );
        });

        expect(postDroppedFiles([new File(['x'], 'web.png')])).toEqual({ status: 'not-on-disk' });
    });

    it('is unavailable without the WebView2 bridge or when posting fails for another reason', () => {
        expect(postDroppedFiles([new File(['x'], 'a.png')])).toEqual({ status: 'unavailable' });

        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        installBridge(() => {
            throw new Error('bridge closed');
        });
        expect(postDroppedFiles([new File(['x'], 'a.png')])).toEqual({ status: 'unavailable' });
    });
});
