import { afterEach, describe, expect, it } from 'vitest';
import type { AppSettings } from '../types';
import { createDefaultAppSettings, DEFAULT_APP_SETTINGS } from './defaultSettings';

describe('createDefaultAppSettings', () => {
    const defaults = DEFAULT_APP_SETTINGS as AppSettings;

    afterEach(() => {
        defaults.resourceFolders = undefined;
        defaults.resourceSortOptions = undefined;
        defaults.systemPrompts = undefined;
    });

    it.each([true, false, undefined])('uses the parent board setting (%s) regardless of the retired child setting', (parent) => {
        for (const child of [true, false, undefined]) {
            const snapshot = { lastSyncedAt: 123, syncBoardsToCollections: child };
            const settings = createDefaultAppSettings({
                invokeSyncBoards: parent,
                syncBoardsToCollections: child,
                lastSyncedAt: 123,
                invokeDbSnapshot: snapshot as AppSettings['invokeDbSnapshot'],
            });
            expect(settings.invokeSyncBoards).toBe(parent !== false);
            expect(settings.syncBoardsToCollections).toBe(parent !== false);
            expect(settings.lastSyncedAt).toBe(123);
            expect(settings.invokeDbSnapshot).toBe(snapshot);
            expect(settings.invokeDbSnapshot?.syncBoardsToCollections).toBe(child);
        }
    });

    it('clones optional default collections when configured', () => {
        defaults.resourceFolders = ['D:/Models'];
        defaults.resourceSortOptions = { loras: 'name' } as unknown as AppSettings['resourceSortOptions'];
        defaults.systemPrompts = { imageAnalysis: 'Analyze' } as AppSettings['systemPrompts'];

        const settings = createDefaultAppSettings();

        expect(settings.resourceFolders).toEqual(['D:/Models']);
        expect(settings.resourceFolders).not.toBe(defaults.resourceFolders);
        expect(settings.resourceSortOptions).not.toBe(defaults.resourceSortOptions);
        expect(settings.systemPrompts).not.toBe(defaults.systemPrompts);
    });
});
