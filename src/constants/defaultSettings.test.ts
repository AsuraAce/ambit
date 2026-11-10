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

    it('defaults the library image kind to All and preserves valid saved choices', () => {
        expect(createDefaultAppSettings().librarySourceKind).toBe('all');
        expect(createDefaultAppSettings({ librarySourceKind: 'photograph' }).librarySourceKind).toBe('photograph');
        expect(createDefaultAppSettings({ librarySourceKind: 'invalid' as AppSettings['librarySourceKind'] }).librarySourceKind).toBe('all');
    });

    it('starts on Details and retains a supported global viewer preference', () => {
        expect(createDefaultAppSettings().viewerPreferredTab).toBe('details');
        expect(createDefaultAppSettings({ viewerPreferredTab: 'workflow' }).viewerPreferredTab).toBe('workflow');
        expect(createDefaultAppSettings({ viewerPreferredTab: 'metadata' }).viewerPreferredTab).toBe('metadata');
        expect(createDefaultAppSettings({ viewerPreferredTab: 'invalid' as AppSettings['viewerPreferredTab'] }).viewerPreferredTab).toBe('details');
    });

    it('upgrades a legacy image kind to Images only when no media scope was saved', () => {
        expect(createDefaultAppSettings().libraryMediaType).toBe('all');
        expect(createDefaultAppSettings({ librarySourceKind: 'photograph' }).libraryMediaType).toBe('image');
        expect(createDefaultAppSettings({ librarySourceKind: 'photograph', libraryMediaType: 'all' }).libraryMediaType).toBe('all');
        expect(createDefaultAppSettings({ librarySourceKind: 'photograph', libraryMediaType: 'video' })).toMatchObject({
            libraryMediaType: 'video', librarySourceKind: 'all',
        });
    });

    it.each(['all', 'video'] as const)('drops an inactive legacy kind when restoring %s', libraryMediaType => {
        expect(createDefaultAppSettings({ libraryMediaType, librarySourceKind: 'photograph' })).toMatchObject({
            libraryMediaType, librarySourceKind: 'all',
        });
    });
});
