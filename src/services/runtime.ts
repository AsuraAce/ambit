export const isTauriRuntime = (): boolean => {
    if (typeof window === 'undefined') return false;

    const runtimeWindow = window as Window & {
        __TAURI_INTERNALS__?: unknown;
        __TAURI__?: unknown;
    };

    return Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__);
};

export const isBrowserMockMode = (): boolean =>
    import.meta.env.DEV &&
    import.meta.env.MODE !== 'test' &&
    typeof window !== 'undefined' &&
    !isTauriRuntime();
