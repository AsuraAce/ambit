type PrivacyMaskRefresh = () => Promise<void>;

let active = false;
let pendingRefresh: PrivacyMaskRefresh | null = null;

const drain = async (): Promise<void> => {
    if (active) return;
    active = true;

    try {
        while (pendingRefresh) {
            const refresh = pendingRefresh;
            pendingRefresh = null;
            await refresh();
        }
    } finally {
        active = false;
        if (pendingRefresh) void drain();
    }
};

export const privacyMaskRefreshCoordinator = {
    schedule(refresh: PrivacyMaskRefresh): void {
        pendingRefresh = refresh;
        void drain();
    },

    discardPending(): void {
        pendingRefresh = null;
    },

    resetForTests(): void {
        active = false;
        pendingRefresh = null;
    },
};
