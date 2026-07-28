import { beforeEach, describe, expect, it } from 'vitest';
import {
    isInvokeOwnerScopeAdmitted,
    useInvokeOwnerScopeStore,
    type InvokeOwnerScopeState,
} from '../invokeOwnerScopeStore';

describe('InvokeAI owner admission state', () => {
    beforeEach(() => {
        useInvokeOwnerScopeStore.getState().resetOwnerScopeState();
    });

    it('admits ordinary libraries that have no configured InvokeAI root', () => {
        expect(isInvokeOwnerScopeAdmitted(undefined, { status: 'idle' })).toBe(true);
        expect(isInvokeOwnerScopeAdmitted('   ', { status: 'error' })).toBe(true);
    });

    it.each([
        ['idle', { status: 'idle' }],
        ['discovering', { status: 'discovering', rootPath: 'D:/Invoke' }],
        ['selection', { status: 'selection_required', rootPath: 'D:/Invoke' }],
        ['error', { status: 'error', rootPath: 'D:/Invoke' }],
        ['stale ready root', { status: 'ready', rootPath: 'D:/Other' }],
    ] satisfies Array<[string, InvokeOwnerScopeState]>)('blocks a configured root in the %s state', (_label, state) => {
        expect(isInvokeOwnerScopeAdmitted('D:/Invoke/databases', state)).toBe(false);
    });

    it.each(['ready', 'offline_ready'] as const)('admits an exact %s root', (status) => {
        expect(isInvokeOwnerScopeAdmitted('D:/Invoke/databases', {
            status,
            rootPath: 'D:\\Invoke',
        })).toBe(true);
    });

    it('supports functional updates without persisting owner admission', () => {
        const store = useInvokeOwnerScopeStore.getState();
        store.setOwnerScopeState({ status: 'discovering', rootPath: 'D:/Invoke' });
        store.setOwnerScopeState(previous => ({ ...previous, status: 'ready' }));

        expect(useInvokeOwnerScopeStore.getState().ownerScopeState).toEqual({
            status: 'ready',
            rootPath: 'D:/Invoke',
        });
    });
});
