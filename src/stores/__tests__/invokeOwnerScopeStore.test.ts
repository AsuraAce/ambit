import { beforeEach, describe, expect, it } from 'vitest';
import {
    isInvokeOwnerScopeAdmitted,
    isOwnerSwitchPending,
    useInvokeOwnerScopeStore,
    type InvokeOwnerScopeState,
    type RetainedOwnerScope,
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
        expect(
            isInvokeOwnerScopeAdmitted('D:/Invoke/databases', {
                status,
                rootPath: 'D:\\Invoke',
            })
        ).toBe(true);
    });

    it('supports functional updates without persisting owner admission', () => {
        const store = useInvokeOwnerScopeStore.getState();
        store.setOwnerScopeState({ status: 'discovering', rootPath: 'D:/Invoke' });
        store.setOwnerScopeState((previous) => ({ ...previous, status: 'ready' }));

        expect(useInvokeOwnerScopeStore.getState().ownerScopeState).toEqual({
            status: 'ready',
            rootPath: 'D:/Invoke',
        });
    });

    describe('retained owner during a user switch (#527)', () => {
        const retained = (operationId: symbol): RetainedOwnerScope => ({
            operationId,
            rootPath: 'D:/Invoke',
            scope: { dbPath: 'D:/Invoke/databases/invokeai.db', imagesRoot: 'D:/Invoke/outputs/images', mode: 'owner', ownerId: 'freya' },
            label: 'Freya',
            targetLabel: 'Odin',
        });

        it('lets only the retaining operation release the shown owner', () => {
            const current = Symbol('current');
            useInvokeOwnerScopeStore.getState().retainOwnerScope(retained(current));

            useInvokeOwnerScopeStore.getState().releaseRetainedOwnerScope(Symbol('stale'));
            expect(isOwnerSwitchPending(useInvokeOwnerScopeStore.getState())).toBe(true);

            useInvokeOwnerScopeStore.getState().releaseRetainedOwnerScope(current);
            expect(isOwnerSwitchPending(useInvokeOwnerScopeStore.getState())).toBe(false);
        });

        // Fail closed: a state that needs the gate must never keep showing the previous owner.
        it.each(['error', 'selection_required', 'idle', 'discovering'] as const)('drops the retained owner on %s', (status) => {
            useInvokeOwnerScopeStore.getState().retainOwnerScope(retained(Symbol('switch')));
            useInvokeOwnerScopeStore.getState().setOwnerScopeState({ status, rootPath: 'D:/Invoke' });
            expect(useInvokeOwnerScopeStore.getState().retainedOwnerScope).toBeNull();
        });

        it.each(['applying', 'ready', 'offline_ready'] as const)('keeps the retained owner while the state is %s', (status) => {
            useInvokeOwnerScopeStore.getState().retainOwnerScope(retained(Symbol('switch')));
            useInvokeOwnerScopeStore.getState().setOwnerScopeState({ status, rootPath: 'D:/Invoke' });
            expect(useInvokeOwnerScopeStore.getState().retainedOwnerScope).not.toBeNull();
        });

        it('clears the retained owner on reset', () => {
            useInvokeOwnerScopeStore.getState().retainOwnerScope(retained(Symbol('switch')));
            useInvokeOwnerScopeStore.getState().resetOwnerScopeState();
            expect(useInvokeOwnerScopeStore.getState().retainedOwnerScope).toBeNull();
        });
    });
});
