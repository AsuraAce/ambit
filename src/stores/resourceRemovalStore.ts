import { create } from 'zustand';

/** Path of the resource folder being removed. Lives outside the Settings UI so a running removal survives closing Settings. */
interface ResourceRemovalStore {
    removingResourcePath: string | null;
    setRemovingResourcePath: (path: string | null) => void;
}

export const useResourceRemovalStore = create<ResourceRemovalStore>((set) => ({
    removingResourcePath: null,
    setRemovingResourcePath: (removingResourcePath) => set({ removingResourcePath }),
}));
