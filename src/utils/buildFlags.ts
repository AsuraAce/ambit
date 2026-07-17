export const isCaptureMode = (): boolean =>
    import.meta.env.VITE_CAPTURE_MODE === 'true';
