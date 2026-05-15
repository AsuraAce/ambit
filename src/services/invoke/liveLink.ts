import { watch } from '@tauri-apps/plugin-fs';

export const startLiveLink = async (invokeAiPath: string, onNewImage: () => void) => {
    if (!invokeAiPath) return null;

    try {
        const imagesPath = `${invokeAiPath}/outputs/images`.replace(/\\/g, '/');
        console.log(`[LiveLink] Starting live watch on: ${imagesPath}`);

        const unwatch = await watch(imagesPath, (event) => {
            // Check if it's a creation event
            // In tauri-plugin-fs v2, event.type can be an object or string
            const eventType = event.type as string | { Create?: unknown; Modify?: unknown };
            const type = typeof eventType === 'string' ? eventType : eventType.Create || eventType.Modify;

            if (type) {
                // Throttle or debounce if needed, but for live watch we want immediate trigger
                onNewImage();
            }
        }, { recursive: false }); // Usually InvokeAI outputs images directly in this folder or subfolders, but recursive: true is safer if they use categories

        return unwatch;
    } catch (err) {
        console.error(`[LiveLink] Failed to start live watch:`, err);
        return null;
    }
};
