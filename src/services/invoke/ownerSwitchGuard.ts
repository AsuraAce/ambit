import { useInvokeOwnerScopeStore } from '../../stores/invokeOwnerScopeStore';

type NotifyOwnerSwitch = (message: string, type: 'info') => void;

/**
 * Refuses a library write while a user owner switch is pending (#527). The gallery may still show the
 * previous owner, but the backend scope already belongs to the target, so a write could land in the
 * wrong owner's view or race the switch's cache work. Call it before any optimistic update.
 * Returns true when the caller must stop.
 */
export const refuseWriteDuringOwnerSwitch = (notify?: NotifyOwnerSwitch): boolean => {
    const retained = useInvokeOwnerScopeStore.getState().retainedOwnerScope;
    if (!retained) return false;
    notify?.(`Finishing the switch to ${retained.targetLabel}. Try again when it is done.`, 'info');
    return true;
};

export class OwnerSwitchPendingError extends Error {
    constructor() {
        super('An InvokeAI owner switch is pending.');
        this.name = 'OwnerSwitchPendingError';
    }
}

/** For writes whose callers expect a failure to throw: notifies, then throws OwnerSwitchPendingError. */
export const assertNoOwnerSwitchPending = (notify?: NotifyOwnerSwitch): void => {
    if (refuseWriteDuringOwnerSwitch(notify)) throw new OwnerSwitchPendingError();
};
