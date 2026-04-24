export const openExternalUrl = async (url: string): Promise<void> => {
    try {
        const { open } = await import('@tauri-apps/plugin-shell');
        await open(url);
        return;
    } catch (error) {
        console.error('Failed to open external URL via Tauri shell:', error);
    }

    window.open(url, '_blank', 'noopener,noreferrer');
};
