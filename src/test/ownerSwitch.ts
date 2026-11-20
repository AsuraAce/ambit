import { useInvokeOwnerScopeStore } from '../stores/invokeOwnerScopeStore';

export const OWNER_SWITCH_TOAST = 'Finishing the switch to Odin. Try again when it is done.';

/** Puts the store in a user owner switch from Freya to Odin (#527). Pair with endOwnerSwitchForTest. */
export const startOwnerSwitchForTest = (): void => {
    useInvokeOwnerScopeStore.getState().retainOwnerScope({
        operationId: Symbol('switch'),
        rootPath: 'D:/Invoke',
        scope: { dbPath: 'D:/Invoke/databases/invokeai.db', imagesRoot: 'D:/Invoke/outputs/images', mode: 'owner', ownerId: 'freya' },
        label: 'Freya',
        targetLabel: 'Odin',
    });
};

export const endOwnerSwitchForTest = (): void => useInvokeOwnerScopeStore.getState().resetOwnerScopeState();
