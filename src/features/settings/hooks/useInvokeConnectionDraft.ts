import * as React from 'react';
import type { AppSettings, InvokeOwnerDiscovery, InvokeOwnerSelection } from '../../../types';
import {
    getInvokeConnectionDraft,
    isSameInvokeConnectionDraft,
    type InvokeConnectionDraft,
} from '../../../services/invoke/connectionDraft';
import { isSameInvokePath } from '../../../services/invoke/pathIdentity';

export interface InvokeConnectionDraftSession {
    draft: InvokeConnectionDraft;
    isDirty: boolean;
    update: (update: Partial<InvokeConnectionDraft>) => void;
    selectOwner: (selection?: InvokeOwnerSelection) => void;
    discard: () => void;
}

export const validateInvokeConnectionDraft = (
    draft: InvokeConnectionDraft,
    discovery?: InvokeOwnerDiscovery,
): { valid: boolean; draft: InvokeConnectionDraft; message?: string } => {
    const invokeAiPath = draft.invokeAiPath.trim();
    if (!invokeAiPath) return { valid: false, draft, message: 'Choose an InvokeAI folder first.' };
    if (!discovery) return { valid: false, draft, message: 'Test the InvokeAI connection before applying it.' };
    if (discovery.schemaMode === 'legacy') {
        return { valid: true, draft: { ...draft, invokeAiPath, invokeOwnerSelection: undefined } };
    }
    const selection = draft.invokeOwnerSelection;
    const validOwner = selection?.mode === 'owner'
        && isSameInvokePath(selection.dbPath, discovery.dbPath)
        && discovery.owners.some(owner => owner.ownerId === selection.ownerId);
    const validAll = selection?.mode === 'all' && isSameInvokePath(selection.dbPath, discovery.dbPath);
    if (!validOwner && !validAll) {
        return { valid: false, draft, message: 'Choose an owner or All users before applying this connection.' };
    }
    return { valid: true, draft: { ...draft, invokeAiPath } };
};

/**
 * Keeps editable InvokeAI connection fields local to one Settings modal session.
 * Applied settings remain the source for cursors, snapshots, and recovery actions.
 */
export const useInvokeConnectionDraft = (
    settings: AppSettings,
    isOpen: boolean,
): InvokeConnectionDraftSession => {
    const appliedDraft = React.useMemo(() => getInvokeConnectionDraft(settings), [settings]);
    const [draft, setDraft] = React.useState<InvokeConnectionDraft>(appliedDraft);
    const wasOpen = React.useRef(isOpen);
    const previousAppliedDraft = React.useRef(appliedDraft);

    React.useEffect(() => {
        if ((isOpen && !wasOpen.current) || (!isOpen && wasOpen.current)) {
            setDraft(appliedDraft);
        } else if (isSameInvokeConnectionDraft(draft, previousAppliedDraft.current)
            && !isSameInvokeConnectionDraft(draft, appliedDraft)) {
            setDraft(appliedDraft);
        }
        wasOpen.current = isOpen;
        previousAppliedDraft.current = appliedDraft;
    }, [appliedDraft, draft, isOpen]);

    const update = React.useCallback((update: Partial<InvokeConnectionDraft>) => {
        setDraft(current => ({ ...current, ...update }));
    }, []);

    const selectOwner = React.useCallback((invokeOwnerSelection?: InvokeOwnerSelection) => {
        setDraft(current => ({ ...current, invokeOwnerSelection }));
    }, []);

    const discard = React.useCallback(() => setDraft(appliedDraft), [appliedDraft]);

    return {
        draft,
        isDirty: !isSameInvokeConnectionDraft(draft, appliedDraft),
        update,
        selectOwner,
        discard,
    };
};
