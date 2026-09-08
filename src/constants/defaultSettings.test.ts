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

    it('upgrades a remembered image kind to Images only when no media scope was saved', () => {
        expect(createDefaultAppSettings().libraryMediaType).toBe('all');
        expect(createDefaultAppSettings({ librarySourceKind: 'photograph' }).libraryMediaType).toBe('image');
        expect(createDefaultAppSettings({ librarySourceKind: 'photograph', libraryMediaType: 'all' }).libraryMediaType).toBe('all');
        expect(createDefaultAppSettings({ librarySourceKind: 'photograph', libraryMediaType: 'video' })).toMatchObject({
            libraryMediaType: 'video', librarySourceKind: 'photograph',
        });
    });
});
