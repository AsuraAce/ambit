import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, InvokeDbSnapshotState } from '../../../types';
import {
    INVOKE_IMPORT_SCHEMA_VERSION,
    INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
} from '../dbSnapshot';
import { readTrustedInvokeOwnerScope } from '../trustedOwnerScope';

const mocks = vi.hoisted(() => ({
    select: vi.fn(),
    getDb: vi.fn(),
}));

vi.mock('../../db/connection', () => ({
    getDb: mocks.getDb,
}));

const dbPath = 'D:/Invoke/databases/invokeai.db';
const imagesRoot = 'D:/Invoke';

const snapshot = (overrides: Partial<InvokeDbSnapshotState> = {}): InvokeDbSnapshotState => ({
    dbPath,
    lastSyncedAt: 1,
    importIntermediates: false,
    importOrphans: false,
    syncBoardsToCollections: true,
    scopeMode: 'owner',
    scopeOwnerId: 'owner-a',
    pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
    importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
    files: [],
    ...overrides,
});

const settings = (overrides: Partial<AppSettings> = {}) => ({
    invokeDbSnapshot: snapshot(),
    invokeOwnerSelection: { dbPath, mode: 'owner', ownerId: 'owner-a' },
    ...overrides,
} as Pick<AppSettings, 'invokeDbSnapshot' | 'invokeOwnerSelection'>);

describe('readTrustedInvokeOwnerScope', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getDb.mockResolvedValue({ select: mocks.select });
        mocks.select.mockResolvedValue([{
            db_path: dbPath,
            images_root: imagesRoot,
            scope_mode: 'owner',
            owner_id: 'owner-a',
        }]);
    });

    it('accepts an exact current snapshot, saved selection, and native visibility row', async () => {
        await expect(readTrustedInvokeOwnerScope('D:/Invoke', settings())).resolves.toEqual({
            dbPath,
            imagesRoot,
            mode: 'owner',
            ownerId: 'owner-a',
        });
    });

    it.each([
        ['configured database path', { invokeDbSnapshot: snapshot({ dbPath: 'D:/Other/invokeai.db' }) }],
        ['import schema version', { invokeDbSnapshot: snapshot({ importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION - 1 }) }],
        ['path repair version', { invokeDbSnapshot: snapshot({ pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION - 1 }) }],
        ['saved selection', { invokeOwnerSelection: { dbPath, mode: 'owner', ownerId: 'owner-b' } }],
    ])('rejects a mismatch in the %s before reading native state', async (_label, overrides) => {
        await expect(readTrustedInvokeOwnerScope('D:/Invoke', settings(overrides as Partial<AppSettings>))).resolves.toBeNull();
        expect(mocks.getDb).not.toHaveBeenCalled();
    });

    it('rejects a native visibility row that does not exactly match the saved scope', async () => {
        mocks.select.mockResolvedValue([{
            db_path: dbPath,
            images_root: imagesRoot,
            scope_mode: 'owner',
            owner_id: 'owner-b',
        }]);

        await expect(readTrustedInvokeOwnerScope('D:/Invoke', settings())).resolves.toBeNull();
    });

    it('requires an explicit matching selection for all-user scope', async () => {
        mocks.select.mockResolvedValue([{
            db_path: dbPath,
            images_root: imagesRoot,
            scope_mode: 'all',
            owner_id: null,
        }]);
        const allSnapshot = snapshot({ scopeMode: 'all', scopeOwnerId: null });

        await expect(readTrustedInvokeOwnerScope('D:/Invoke', settings({
            invokeDbSnapshot: allSnapshot,
            invokeOwnerSelection: { dbPath, mode: 'all' },
        }))).resolves.toEqual({ dbPath, imagesRoot, mode: 'all' });
        await expect(readTrustedInvokeOwnerScope('D:/Invoke', settings({
            invokeDbSnapshot: allSnapshot,
            invokeOwnerSelection: undefined,
        }))).resolves.toBeNull();
    });

    it('trusts legacy scope only when no owner selection remains', async () => {
        mocks.select.mockResolvedValue([{
            db_path: dbPath,
            images_root: imagesRoot,
            scope_mode: 'legacy',
            owner_id: null,
        }]);
        const legacySnapshot = snapshot({ scopeMode: 'legacy', scopeOwnerId: null });

        await expect(readTrustedInvokeOwnerScope('D:/Invoke', settings({
            invokeDbSnapshot: legacySnapshot,
            invokeOwnerSelection: undefined,
        }))).resolves.toEqual({ dbPath, imagesRoot, mode: 'legacy' });
        await expect(readTrustedInvokeOwnerScope('D:/Invoke', settings({
            invokeDbSnapshot: legacySnapshot,
        }))).resolves.toBeNull();
    });
});
