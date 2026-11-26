import { create } from 'zustand';

interface WorkflowGraphState {
    /** True while the full-screen workflow graph is mounted; the viewer and app shortcuts stand down. */
    open: boolean;
    setOpen: (open: boolean) => void;
}

// Transient UI state only: nothing about the graph's content is kept here.
export const useWorkflowGraphStore = create<WorkflowGraphState>()((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
}));

/** Read outside React, in key handlers. */
export const isWorkflowGraphOpen = (): boolean => useWorkflowGraphStore.getState().open;
