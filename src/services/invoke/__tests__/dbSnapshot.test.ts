import { describe, expect, it, vi } from 'vitest';
import type { InvokeDbSnapshotState } from '../../../types';
import {
    buildInvokeDbSnapshotState,
    INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
    isInvokeDbSnapshotCurrent,
    readInvokeDbSnapshotState,
} from '../dbSnapshot';

const getInvokeDbSnapshot = vi.hoisted(() => vi.fn());

vi.mock('../../../bindings', () => ({
    commands: { getInvokeDbSnapshot },
}));

const baseSnapshot = {
    dbPath: 'D:/Invoke/databases/invokeai.db',
    files: [
        {
            path: 'D:/Invoke/databases/invokeai.db-wal',
            exists: false,
            size: 0,
            modifiedMs: null
        },
        {
            path: 'D:/Invoke/databases/invokeai.db',
            exists: true,
            size: 10,
            modifiedMs: 100
        },
        {
            path: 'D:/Invoke/databases/invokeai.db-shm',
            exists: false,
            size: 0,
            modifiedMs: null
        }
    ]
};

describe('Invoke DB startup snapshot matching', () => {
    it('matches unchanged file snapshots even when file order differs', () => {
        const saved = buildInvokeDbSnapshotState(baseSnapshot, {
            lastSyncedAt: 1000,
            importIntermediates: false,
            importOrphans: false,
            syncBoardsToCollections: true
        });

        const current = buildInvokeDbSnapshotState({
            ...baseSnapshot,
            files: [...baseSnapshot.files].reverse()
        }, {
            lastSyncedAt: 1000,
            importIntermediates: false,
            importOrphans: false,
            syncBoardsToCollections: true
        });

        expect(isInvokeDbSnapshotCurrent(saved, current)).toBe(true);
        expect(current.pathRepairVersion).toBe(INVOKE_PATH_REPAIR_SNAPSHOT_VERSION);
    });

    it('invalidates when sync cursor or import flags change', () => {
        const saved = buildInvokeDbSnapshotState(baseSnapshot, {
            lastSyncedAt: 1000,
            importIntermediates: false,
            importOrphans: false,
            syncBoardsToCollections: false
        });

        expect(isInvokeDbSnapshotCurrent(saved, buildInvokeDbSnapshotState(baseSnapshot, {
            lastSyncedAt: 1001,
            importIntermediates: false,
            importOrphans: false,
            syncBoardsToCollections: false
        }))).toBe(false);

        expect(isInvokeDbSnapshotCurrent(saved, buildInvokeDbSnapshotState(baseSnapshot, {
            lastSyncedAt: 1000,
            importIntermediates: true,
            importOrphans: false,
            syncBoardsToCollections: false
        }))).toBe(false);

        expect(isInvokeDbSnapshotCurrent(saved, buildInvokeDbSnapshotState(baseSnapshot, {
            lastSyncedAt: 1000,
            importIntermediates: false,
            importOrphans: true,
            syncBoardsToCollections: false
        }))).toBe(false);
    });

    it('invalidates when a missing WAL appears', () => {
        const saved = buildInvokeDbSnapshotState(baseSnapshot, {
            lastSyncedAt: 1000,
            importIntermediates: false,
            importOrphans: false,
            syncBoardsToCollections: false
        });
        const currentRaw = {
            ...baseSnapshot,
            files: baseSnapshot.files.map(file =>
                file.path.endsWith('.db-wal')
                    ? { ...file, exists: true, size: 50, modifiedMs: 200 }
                    : file
            )
        };

        const current = buildInvokeDbSnapshotState(currentRaw, {
            lastSyncedAt: 1000,
            importIntermediates: false,
            importOrphans: false,
            syncBoardsToCollections: false
        });

        expect(isInvokeDbSnapshotCurrent(saved, current)).toBe(false);
    });

    it('invalidates saved snapshots that predate the Invoke path repair marker', () => {
        const current = buildInvokeDbSnapshotState(baseSnapshot, {
            lastSyncedAt: 1000,
            importIntermediates: false,
            importOrphans: false,
            syncBoardsToCollections: false
        });
        const legacySaved = { ...current } as Partial<InvokeDbSnapshotState>;
        delete legacySaved.pathRepairVersion;

        expect(isInvokeDbSnapshotCurrent(legacySaved as InvokeDbSnapshotState, current)).toBe(false);
    });

    it('invalidates saved snapshots with an older path repair marker', () => {
        const current = buildInvokeDbSnapshotState(baseSnapshot, {
            lastSyncedAt: 1000,
            importIntermediates: false,
            importOrphans: false,
            syncBoardsToCollections: false
        });
        const oldRepairSnapshot = {
            ...current,
            pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION - 1
        };

        expect(isInvokeDbSnapshotCurrent(oldRepairSnapshot, current)).toBe(false);
    });

    it('reads and normalizes snapshot state through the backend command', async () => {
        getInvokeDbSnapshot.mockResolvedValue({ status: 'ok', data: baseSnapshot });

        await expect(readInvokeDbSnapshotState('D:/Invoke', {})).resolves.toMatchObject({
            dbPath: baseSnapshot.dbPath,
            lastSyncedAt: null,
            importIntermediates: false,
            importOrphans: false,
            syncBoardsToCollections: false,
            files: expect.arrayContaining([
                expect.objectContaining({ path: 'D:/Invoke/databases/invokeai.db', modifiedMs: 100 }),
            ]),
        });
        expect(getInvokeDbSnapshot).toHaveBeenCalledWith('D:/Invoke');
    });

    it('invalidates absent, differently configured, and structurally changed snapshots', () => {
        const current = buildInvokeDbSnapshotState(baseSnapshot, { syncBoardsToCollections: true });

        expect(isInvokeDbSnapshotCurrent(undefined, current)).toBe(false);
        expect(isInvokeDbSnapshotCurrent({ ...current, dbPath: 'other.db' }, current)).toBe(false);
        expect(isInvokeDbSnapshotCurrent({ ...current, syncBoardsToCollections: false }, current)).toBe(false);
        expect(isInvokeDbSnapshotCurrent({ ...current, files: current.files.slice(1) }, current)).toBe(false);

        for (const changedFile of [
            { ...current.files[0], path: 'different' },
            { ...current.files[0], exists: !current.files[0].exists },
            { ...current.files[0], size: current.files[0].size + 1 },
            { ...current.files[0], modifiedMs: 999 },
        ]) {
            expect(isInvokeDbSnapshotCurrent({
                ...current,
                files: [changedFile, ...current.files.slice(1)],
            }, current)).toBe(false);
        }
    });
});
