import { describe, expect, it } from 'vitest';
import type { InvokeOwnerScopeState } from '../../stores/invokeOwnerScopeStore';
import { getInvokeOwnerQueryScopeKey } from '../invokeOwnerQueryScope';

const readyOwnerScope = (dbPath: string): InvokeOwnerScopeState => ({
    status: 'ready',
    rootPath: dbPath,
    scope: {
        mode: 'owner',
        ownerId: 'owner-a',
        dbPath,
        imagesRoot: dbPath,
    },
});

describe('Invoke owner query scope identity', () => {
    it('keeps case-distinct POSIX databases in separate query caches', () => {
        const upperCasePath = '/mnt/Invoke/databases/invokeai.db';
        const lowerCasePath = '/mnt/invoke/databases/invokeai.db';

        expect(getInvokeOwnerQueryScopeKey(upperCasePath, readyOwnerScope(upperCasePath)))
            .not.toBe(getInvokeOwnerQueryScopeKey(lowerCasePath, readyOwnerScope(lowerCasePath)));
    });

    it('shares a query cache identity for Windows path case variants', () => {
        const upperCasePath = 'C:\\Invoke\\databases\\invokeai.db';
        const lowerCasePath = 'c:/invoke/databases/invokeai.db';

        expect(getInvokeOwnerQueryScopeKey(upperCasePath, readyOwnerScope(upperCasePath)))
            .toBe(getInvokeOwnerQueryScopeKey(lowerCasePath, readyOwnerScope(lowerCasePath)));
    });
});
