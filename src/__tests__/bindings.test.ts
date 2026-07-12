import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
    invoke: invokeMock,
    Channel: class {},
}));

type CommandCase = {
    name: string;
    invokeName: string;
    args: unknown[];
    payload?: Record<string, unknown>;
    returnsResult: boolean;
};

const okResult = { value: 'ok' };

const commandCases: CommandCase[] = [
    { name: 'saveApiKey', invokeName: 'save_api_key', args: ['key'], payload: { key: 'key' }, returnsResult: true },
    { name: 'loadApiKey', invokeName: 'load_api_key', args: [], returnsResult: true },
    { name: 'deleteApiKey', invokeName: 'delete_api_key', args: [], returnsResult: true },
    { name: 'saveImagesBatch', invokeName: 'save_images_batch', args: [[]], payload: { images: [] }, returnsResult: true },
    { name: 'moveImagePathIdentities', invokeName: 'move_image_path_identities', args: [[]], payload: { moves: [] }, returnsResult: true },
    { name: 'getMainDatabaseUrl', invokeName: 'get_main_database_url', args: [], returnsResult: true },
    { name: 'getDbDiagnostics', invokeName: 'get_db_diagnostics', args: [], returnsResult: true },
    { name: 'showAppLogFolder', invokeName: 'show_app_log_folder', args: [], returnsResult: true },
    { name: 'backfillImageFileHashes', invokeName: 'backfill_image_file_hashes', args: [10], payload: { limit: 10 }, returnsResult: true },
    { name: 'cancelImageFileHashBackfill', invokeName: 'cancel_image_file_hash_backfill', args: [], returnsResult: false },
    { name: 'refreshBoardsNative', invokeName: 'refresh_boards_native', args: [{ board: 'collection' }], payload: { boardMapping: { board: 'collection' } }, returnsResult: true },
    { name: 'getImageCountForPathPrefix', invokeName: 'get_image_count_for_path_prefix', args: ['C:/library'], payload: { path: 'C:/library' }, returnsResult: true },
    { name: 'refreshPrivacyMaskIndex', invokeName: 'refresh_privacy_mask_index', args: [['nsfw']], payload: { maskedKeywords: ['nsfw'] }, returnsResult: true },
    { name: 'optimizeDatabase', invokeName: 'optimize_database', args: [], returnsResult: true },
    { name: 'purgeDatabase', invokeName: 'purge_database', args: [], returnsResult: true },
    { name: 'getParameterRanges', invokeName: 'get_parameter_ranges', args: ['WHERE 1', '[]', null, 'lora'], payload: { whereClause: 'WHERE 1', paramsJson: '[]', collectionId: null, loraName: 'lora' }, returnsResult: true },
    { name: 'backfillParameterColumns', invokeName: 'backfill_parameter_columns', args: [], returnsResult: true },
    { name: 'rebuildFacetCache', invokeName: 'rebuild_facet_cache', args: [], returnsResult: true },
    { name: 'rebuildFacetCacheIncremental', invokeName: 'rebuild_facet_cache_incremental', args: ['loras'], payload: { facetType: 'loras' }, returnsResult: true },
    { name: 'rebuildFacetCacheIncrementalBatch', invokeName: 'rebuild_facet_cache_incremental_batch', args: [['loras']], payload: { facetTypes: ['loras'] }, returnsResult: true },
    { name: 'refreshFacetCacheForResources', invokeName: 'refresh_facet_cache_for_resources', args: [{ loras: ['a'] }], payload: { touches: { loras: ['a'] } }, returnsResult: true },
    { name: 'getValidFacetNames', invokeName: 'get_valid_facet_names', args: ['WHERE 1', '[]', null, null], payload: { whereClause: 'WHERE 1', paramsJson: '[]', collectionId: null, loraName: null }, returnsResult: true },
    { name: 'markImagesCorrupt', invokeName: 'mark_images_corrupt', args: [['id']], payload: { ids: ['id'] }, returnsResult: true },
    { name: 'verifyLibraryIntegrity', invokeName: 'verify_library_integrity', args: [], returnsResult: true },
    { name: 'startReparseJob', invokeName: 'start_reparse_job', args: [true, 'C:/root', 'ComfyUI'], payload: { forceReparse: true, filterRoot: 'C:/root', filterTool: 'ComfyUI' }, returnsResult: true },
    { name: 'cancelReparseJob', invokeName: 'cancel_reparse_job', args: [], returnsResult: false },
    { name: 'getImagesNeedingReparse', invokeName: 'get_images_needing_reparse', args: [25], payload: { limit: 25 }, returnsResult: true },
    { name: 'getReparseCount', invokeName: 'get_reparse_count', args: [], returnsResult: true },
    { name: 'reparseMetadataBatch', invokeName: 'reparse_metadata_batch', args: [[]], payload: { images: [] }, returnsResult: true },
    { name: 'resetParserVersions', invokeName: 'reset_parser_versions', args: [], returnsResult: true },
    { name: 'getMetadataStats', invokeName: 'get_metadata_stats', args: [], returnsResult: true },
    { name: 'getBackups', invokeName: 'get_backups', args: [], returnsResult: true },
    { name: 'backupDatabase', invokeName: 'backup_database', args: [], returnsResult: true },
    { name: 'checkAndRunAutobackup', invokeName: 'check_and_run_autobackup', args: [], returnsResult: true },
    { name: 'scanImage', invokeName: 'scan_image', args: ['C:/image.png', 'C:/thumbs', false, true, 'ComfyUI'], payload: { path: 'C:/image.png', thumbnailDir: 'C:/thumbs', skipThumbnail: false, extractWorkflow: true, defaultTool: 'ComfyUI' }, returnsResult: true },
    { name: 'scanImagesBulk', invokeName: 'scan_images_bulk', args: [['C:/image.png'], null, true, false, null, 'run-1'], payload: { paths: ['C:/image.png'], thumbnailDir: null, skipThumbnail: true, extractWorkflow: false, defaultTool: null, progressRunId: 'run-1' }, returnsResult: true },
    { name: 'scanImageWorkflow', invokeName: 'scan_image_workflow', args: ['C:/image.png'], payload: { path: 'C:/image.png' }, returnsResult: true },
    { name: 'readImageMetadata', invokeName: 'read_image_metadata', args: ['C:/image.png', null], payload: { path: 'C:/image.png', defaultTool: null }, returnsResult: true },
    { name: 'inspectComfyuiMetadataChunks', invokeName: 'inspect_comfyui_metadata_chunks', args: [{ prompt: '{}' }], payload: { chunks: { prompt: '{}' } }, returnsResult: true },
    { name: 'getFileSizesBulk', invokeName: 'get_file_sizes_bulk', args: [['C:/image.png']], payload: { paths: ['C:/image.png'] }, returnsResult: true },
    { name: 'verifyImagePaths', invokeName: 'verify_image_paths', args: [['C:/image.png']], payload: { paths: ['C:/image.png'] }, returnsResult: true },
    { name: 'auditInvokeaiFolder', invokeName: 'audit_invokeai_folder', args: ['C:/invoke'], payload: { path: 'C:/invoke' }, returnsResult: true },
    { name: 'listInvokeaiImages', invokeName: 'list_invokeai_images', args: ['C:/invoke'], payload: { path: 'C:/invoke' }, returnsResult: true },
    { name: 'scanDirectoryRecursive', invokeName: 'scan_directory_recursive', args: ['C:/library'], payload: { path: 'C:/library' }, returnsResult: true },
    { name: 'openFile', invokeName: 'open_file', args: ['C:/image.png'], payload: { path: 'C:/image.png' }, returnsResult: true },
    { name: 'showInFolder', invokeName: 'show_in_folder', args: ['C:/image.png'], payload: { path: 'C:/image.png' }, returnsResult: true },
    { name: 'scanDirectoryWithStats', invokeName: 'scan_directory_with_stats', args: ['C:/library'], payload: { path: 'C:/library' }, returnsResult: true },
    { name: 'scanDirectorySince', invokeName: 'scan_directory_since', args: ['C:/library', 123], payload: { path: 'C:/library', since: 123 }, returnsResult: true },
    { name: 'discoverA1111Folders', invokeName: 'discover_a1111_folders', args: ['C:/a1111'], payload: { rootPath: 'C:/a1111' }, returnsResult: true },
    { name: 'startThumbnailOptimizationJob', invokeName: 'start_thumbnail_optimization_job', args: [{ thumbnailDir: 'C:/thumbs', includeUpgradeable: true, profile: 'fast' }], payload: { config: { thumbnailDir: 'C:/thumbs', includeUpgradeable: true, profile: 'fast' } }, returnsResult: true },
    { name: 'cancelThumbnailOptimizationJob', invokeName: 'cancel_thumbnail_optimization_job', args: [], returnsResult: false },
    { name: 'setThumbnailOptimizationThrottled', invokeName: 'set_thumbnail_optimization_throttled', args: [true], payload: { throttled: true }, returnsResult: false },
    { name: 'getThumbnailOptimizationFailures', invokeName: 'get_thumbnail_optimization_failures', args: [50], payload: { limit: 50 }, returnsResult: true },
    { name: 'retryFailedThumbnailOptimizations', invokeName: 'retry_failed_thumbnail_optimizations', args: [], returnsResult: true },
    { name: 'startNativeFolderWatcher', invokeName: 'start_native_folder_watcher', args: [['C:/library']], payload: { paths: ['C:/library'] }, returnsResult: true },
    { name: 'importA1111Cache', invokeName: 'import_a1111_cache', args: ['C:/cache.json'], payload: { cachePath: 'C:/cache.json' }, returnsResult: true },
    { name: 'resolveHashesOnline', invokeName: 'resolve_hashes_online', args: [true], payload: { skipHarvest: true }, returnsResult: true },
    { name: 'clearModelCache', invokeName: 'clear_model_cache', args: [], returnsResult: true },
    { name: 'cancelModelResolution', invokeName: 'cancel_model_resolution', args: [], returnsResult: false },
    { name: 'cancelModelDiscovery', invokeName: 'cancel_model_discovery', args: [], returnsResult: false },
    { name: 'scanModelThumbnails', invokeName: 'scan_model_thumbnails', args: [['C:/model.safetensors']], payload: { paths: ['C:/model.safetensors'] }, returnsResult: true },
    { name: 'purgeResourceFolderAssets', invokeName: 'purge_resource_folder_assets', args: ['C:/models', ['C:/models/a.safetensors']], payload: { path: 'C:/models', remainingPaths: ['C:/models/a.safetensors'] }, returnsResult: true },
    { name: 'setModelThumbnail', invokeName: 'set_model_thumbnail', args: ['hash', 'model', 'C:/image.png', 'checkpoint'], payload: { modelHash: 'hash', modelName: 'model', imagePath: 'C:/image.png', resourceType: 'checkpoint' }, returnsResult: true },
    { name: 'unsetModelThumbnail', invokeName: 'unset_model_thumbnail', args: ['hash', null, 'checkpoint'], payload: { modelHash: 'hash', modelName: null, resourceType: 'checkpoint' }, returnsResult: true },
    { name: 'clearAllThumbnails', invokeName: 'clear_all_thumbnails', args: ['hash', null, null], payload: { modelHash: 'hash', modelName: null, resourceType: null }, returnsResult: true },
    { name: 'setResourceThumbnailSensitivity', invokeName: 'set_resource_thumbnail_sensitivity', args: ['hash', 'model', false, 'lora'], payload: { modelHash: 'hash', modelName: 'model', sensitivity: false, resourceType: 'lora' }, returnsResult: true },
    { name: 'moveToTrash', invokeName: 'move_to_trash', args: ['C:/image.png'], payload: { path: 'C:/image.png' }, returnsResult: true },
    { name: 'deleteThumbnail', invokeName: 'delete_thumbnail', args: ['C:/thumb.webp'], payload: { path: 'C:/thumb.webp' }, returnsResult: true },
    { name: 'registerLibraryPath', invokeName: 'register_library_path', args: ['C:/library'], payload: { path: 'C:/library' }, returnsResult: true },
    { name: 'getInvokeDbSnapshot', invokeName: 'get_invoke_db_snapshot', args: ['C:/invoke'], payload: { rootPath: 'C:/invoke' }, returnsResult: true },
];

describe('generated Tauri bindings', () => {
    beforeEach(() => {
        invokeMock.mockReset();
    });

    it('maps every generated command wrapper to the expected Tauri command and payload', async () => {
        const { commands } = await import('../bindings');
        const commandNames = Object.keys(commands);

        expect(commandCases.map(({ name }) => name).sort()).toEqual(commandNames.sort());

        for (const testCase of commandCases) {
            invokeMock.mockResolvedValueOnce(okResult);
            const command = commands[testCase.name as keyof typeof commands] as (...args: unknown[]) => Promise<unknown>;

            const result = await command(...testCase.args);

            if (testCase.returnsResult) {
                expect(result).toEqual({ status: 'ok', data: okResult });
            } else {
                expect(result).toBeUndefined();
            }

            if (testCase.payload === undefined) {
                expect(invokeMock).toHaveBeenLastCalledWith(testCase.invokeName);
            } else {
                expect(invokeMock).toHaveBeenLastCalledWith(testCase.invokeName, testCase.payload);
            }
        }
    });

    it('wraps non-Error rejections in generated Result errors and rethrows Error objects', async () => {
        const { commands } = await import('../bindings');

        for (const testCase of commandCases.filter(({ returnsResult }) => returnsResult)) {
            invokeMock.mockRejectedValueOnce(`${testCase.name}-denied`);
            const command = commands[testCase.name as keyof typeof commands] as (...args: unknown[]) => Promise<unknown>;

            await expect(command(...testCase.args)).resolves.toEqual({
                status: 'error',
                error: `${testCase.name}-denied`,
            });
        }

        for (const testCase of commandCases.filter(({ returnsResult }) => returnsResult)) {
            const failure = new Error(`${testCase.name}-boom`);
            invokeMock.mockRejectedValueOnce(failure);
            const command = commands[testCase.name as keyof typeof commands] as (...args: unknown[]) => Promise<unknown>;

            await expect(command(...testCase.args)).rejects.toThrow(failure);
        }
    });
});
