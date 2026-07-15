import { BaseDirectory, exists, mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { commands } from '../bindings';
import { AppState, IRepository, PurgeScheduleResult } from './repository';
import { INITIAL_COLLECTIONS } from '../constants';
import { createDefaultAppSettings } from '../constants/defaultSettings';
import { AppSettings, Collection, FilterState, SmartCollection } from '../types';
import { createDefaultFilters } from '../utils/filterState';
import { isValidGeneratorTool } from '../utils/validation';

type PersistedCollection = Omit<Collection, 'createdAt' | 'filters' | 'imageIds'> & {
    createdAt?: number;
    filters?: Partial<FilterState>;
    imageIds?: string[];
};

type PersistedSmartCollection = Omit<SmartCollection, 'createdAt' | 'filters' | 'imageIds'> & {
    createdAt?: number;
    filters: Partial<FilterState>;
    imageIds?: string[];
};

interface PersistedAppState {
    images: Record<string, unknown>[];
    collections: PersistedCollection[];
    smartCollections: PersistedSmartCollection[];
    settings: Partial<AppSettings>;
    recentSearches: string[];
}

interface PersistedStateCandidate {
    content: string;
    state: PersistedAppState;
}

interface PersistedStateJournal {
    version: 1;
    transactionId: string;
    phase: 'prepared' | 'committed';
    before: PersistedAppState;
    after: PersistedAppState;
}

interface PersistedCommitMarker {
    version: 1;
    transactionId: string;
}

interface PersistedPurgeJournal {
    version: 1;
    transactionId: string;
    before: PersistedAppState;
    after: PersistedAppState;
}

interface ResolvedStateJournal {
    phase: 'prepared' | 'committed';
    before: PersistedStateCandidate;
    after: PersistedStateCandidate;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const isNotFoundFsError = (error: unknown): boolean => {
    if (isRecord(error)) {
        const code = error.code;
        const kind = error.kind;
        if (code === 'ENOENT' || code === 'NotFound' || kind === 'NotFound') return true;
    }

    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    return normalized === 'not found'
        || normalized.includes('no such file or directory')
        || normalized.includes('path not found')
        || /\benoent\b/.test(normalized)
        || /\bos error 2\b/.test(normalized);
};

const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every(item => typeof item === 'string');

const hasValidOptionalValue = (
    record: Record<string, unknown>,
    key: string,
    validate: (value: unknown) => boolean
): boolean => record[key] === undefined || validate(record[key]);

const isEnumValue = (value: unknown, allowedValues: readonly string[]): boolean =>
    typeof value === 'string' && allowedValues.includes(value);

const isRecordWithValues = (
    value: unknown,
    validate: (item: unknown) => boolean,
    allowedKeys?: readonly string[]
): boolean => isRecord(value)
    && (!allowedKeys || Object.keys(value).every(key => allowedKeys.includes(key)))
    && Object.values(value).every(validate);

const isPersistedMonitoredFolder = (value: unknown): boolean => {
    if (!isRecord(value)) return false;

    return typeof value.id === 'string'
        && typeof value.path === 'string'
        && typeof value.isActive === 'boolean'
        && typeof value.imageCount === 'number'
        && hasValidOptionalValue(value, 'isManaged', item => typeof item === 'boolean')
        && hasValidOptionalValue(value, 'pathRaw', item => typeof item === 'string')
        && hasValidOptionalValue(value, 'lastScanned', item => typeof item === 'number')
        && hasValidOptionalValue(value, 'variant', item =>
            typeof item === 'string' && isValidGeneratorTool(item))
        && hasValidOptionalValue(value, 'initialScanPending', item => typeof item === 'boolean')
        && hasValidOptionalValue(value, 'initialScanCancelled', item => typeof item === 'boolean');
};

const isPersistedFilterState = (value: unknown): boolean => {
    if (!isRecord(value)) return false;

    const stringArrayKeys = [
        'models', 'loras', 'embeddings', 'hypernetworks', 'samplers', 'generationTypes',
        'controlNets', 'ipAdapters'
    ];
    const numberKeys = ['minSteps', 'maxSteps', 'minCfg', 'maxCfg'];
    const booleanKeys = ['favoritesOnly', 'pinnedOnly', 'showIntermediates', 'showGrids'];
    const aliasKeys = ['models', 'loras', 'embeddings', 'hypernetworks', 'controlNets', 'ipAdapters'];

    return hasValidOptionalValue(value, 'searchQuery', item => typeof item === 'string')
        && stringArrayKeys.every(key => hasValidOptionalValue(value, key, isStringArray))
        && hasValidOptionalValue(value, 'tools', item =>
            Array.isArray(item)
            && item.every(tool => typeof tool === 'string' && isValidGeneratorTool(tool)))
        && hasValidOptionalValue(value, 'dateRange', item =>
            isEnumValue(item, ['all', 'today', 'week', 'month', 'custom']))
        && hasValidOptionalValue(value, 'dateFrom', item => typeof item === 'string')
        && hasValidOptionalValue(value, 'dateTo', item => typeof item === 'string')
        && booleanKeys.every(key => hasValidOptionalValue(value, key, item => typeof item === 'boolean'))
        && hasValidOptionalValue(value, 'collectionId', item => item === null || typeof item === 'string')
        && numberKeys.every(key => hasValidOptionalValue(value, key, item => typeof item === 'number'))
        && hasValidOptionalValue(value, 'sortOption', item =>
            isEnumValue(item, ['date_desc', 'date_asc', 'name_asc', 'name_desc', 'size_desc', 'size_asc']))
        && hasValidOptionalValue(value, 'matchModes', item =>
            isRecordWithValues(item, mode => isEnumValue(mode, ['any', 'all'])))
        && hasValidOptionalValue(value, 'assetFilterAliases', item =>
            isRecordWithValues(
                item,
                aliases => isRecordWithValues(aliases, isStringArray),
                aliasKeys
            ));
};

const isPersistedCollection = (value: unknown, requireFilters = false): boolean => {
    if (!isRecord(value)) return false;

    return typeof value.id === 'string'
        && typeof value.name === 'string'
        && hasValidOptionalValue(value, 'description', item => typeof item === 'string')
        && hasValidOptionalValue(value, 'imageIds', isStringArray)
        && hasValidOptionalValue(value, 'count', item => typeof item === 'number')
        && hasValidOptionalValue(value, 'thumbnail', item => typeof item === 'string')
        && hasValidOptionalValue(value, 'customThumbnail', item => typeof item === 'string')
        && hasValidOptionalValue(value, 'safeThumbnail', item => typeof item === 'string')
        && hasValidOptionalValue(value, 'thumbnailIsSensitive', item => typeof item === 'boolean')
        && hasValidOptionalValue(value, 'thumbnailSourceKind', item =>
            isEnumValue(item, ['dynamic', 'customImage', 'customPath']))
        && hasValidOptionalValue(value, 'color', item => typeof item === 'string')
        && hasValidOptionalValue(value, 'createdAt', item => typeof item === 'number')
        && hasValidOptionalValue(value, 'updatedAt', item => typeof item === 'number')
        && hasValidOptionalValue(value, 'isArchived', item => typeof item === 'boolean')
        && hasValidOptionalValue(value, 'isPinned', item => typeof item === 'boolean')
        && hasValidOptionalValue(value, 'manualExclusions', isStringArray)
        && hasValidOptionalValue(value, 'source', item => isEnumValue(item, ['ambit', 'invoke']))
        && (requireFilters
            ? value.filters !== undefined && isPersistedFilterState(value.filters)
            : hasValidOptionalValue(value, 'filters', isPersistedFilterState));
};

const isStringRecord = (value: unknown, allowedValues?: readonly string[]): boolean =>
    isRecordWithValues(value, item =>
        typeof item === 'string' && (!allowedValues || allowedValues.includes(item)));

const isPersistedInvokeSnapshot = (value: unknown): boolean => {
    if (!isRecord(value) || !Array.isArray(value.files)) return false;

    return typeof value.dbPath === 'string'
        && (value.lastSyncedAt === null || typeof value.lastSyncedAt === 'number')
        && typeof value.importIntermediates === 'boolean'
        && typeof value.importOrphans === 'boolean'
        && typeof value.syncBoardsToCollections === 'boolean'
        && hasValidOptionalValue(value, 'pathRepairVersion', item => typeof item === 'number')
        && value.files.every(file => isRecord(file)
            && typeof file.path === 'string'
            && typeof file.exists === 'boolean'
            && typeof file.size === 'number'
            && (file.modifiedMs === null || typeof file.modifiedMs === 'number'));
};

const isPersistedSettings = (value: unknown): boolean => {
    if (!isRecord(value)) return false;

    const booleanKeys = [
        'hasCompletedOnboarding', 'autoCheckForUpdates', 'confirmDelete', 'defaultTheaterMode',
        'enableAI', 'syncBoardsToCollections', 'invokeSyncFavorites', 'invokeSyncBoards',
        'importIntermediates', 'importOrphans', 'libraryShowGrids', 'libraryShowIntermediates',
        'devMode', 'enableAutoThumbnailHealing', 'enforceHighQualityThumbnails'
    ];
    const stringKeys = [
        'googleGeminiApiKey', 'aiModel', 'invokeAiPath', 'a1111Path', 'comfyUiPath'
    ];

    return booleanKeys.every(key => hasValidOptionalValue(value, key, item => typeof item === 'boolean'))
        && stringKeys.every(key => hasValidOptionalValue(value, key, item => typeof item === 'string'))
        && hasValidOptionalValue(value, 'theme', item => item === 'dark' || item === 'light')
        && hasValidOptionalValue(value, 'thumbnailSize', item => typeof item === 'number')
        && hasValidOptionalValue(value, 'maskedKeywords', isStringArray)
        && hasValidOptionalValue(value, 'maskingMode', item => item === 'blur' || item === 'hide')
        && hasValidOptionalValue(value, 'aiThinkingMode', item =>
            ['default', 'minimal', 'low', 'medium', 'high', 'off', 'dynamic'].includes(String(item)))
        && hasValidOptionalValue(value, 'lastSyncedAt', item => item === null || typeof item === 'number')
        && hasValidOptionalValue(value, 'starredAs', item =>
            ['favorite', 'pin', 'both', 'none'].includes(String(item)))
        && hasValidOptionalValue(value, 'libraryLayoutMode', item =>
            ['grid', 'masonry', 'justified'].includes(String(item)))
        && hasValidOptionalValue(value, 'thumbnailOptimizationProfile', item =>
            ['quiet', 'balanced', 'fast'].includes(String(item)))
        && hasValidOptionalValue(value, 'logLevel', item =>
            ['debug', 'info', 'warn', 'error', 'none'].includes(String(item)))
        && hasValidOptionalValue(value, 'monitoredFolders', item =>
            Array.isArray(item) && item.every(isPersistedMonitoredFolder))
        && hasValidOptionalValue(value, 'resourceFolders', isStringArray)
        && hasValidOptionalValue(value, 'resourceViewModes', item => isStringRecord(item, ['grid', 'list']))
        && hasValidOptionalValue(value, 'resourceSortOptions', item => isStringRecord(item, [
            'count_desc', 'count_asc', 'name_asc', 'name_desc', 'recent_desc', 'recent_asc',
            'added_desc', 'added_asc', 'date_desc', 'date_asc'
        ]))
        && hasValidOptionalValue(value, 'systemPrompts', item => isStringRecord(item))
        && hasValidOptionalValue(value, 'invokeDbSnapshot', isPersistedInvokeSnapshot);
};

export class TauriFsRepository implements IRepository {
    private readonly fileName = 'library.json';
    private readonly pendingFileName = 'library.json.pending';
    private readonly commitFileName = 'library.json.pending.commit';
    private readonly backupFileName = 'library.json.bak';
    private readonly purgeJournalFileName = 'library.purge.json';
    private readonly purgeCompletionFileName = 'library.purge.completed';
    private readonly baseDir = BaseDirectory.AppLocalData;
    private hasLoggedDirectoryError = false;
    private operationQueue: Promise<void> = Promise.resolve();

    async load(): Promise<AppState> {
        return this.enqueue(() => {
            return this.loadUnlocked();
        });
    }

    async save(state: AppState): Promise<void> {
        await this.enqueue(() => {
            return this.saveUnlocked(state);
        });
    }

    async update(updater: (state: AppState) => AppState): Promise<AppState> {
        return this.enqueue(async () => {
            const nextState = updater(await this.loadUnlocked());
            await this.saveUnlocked(nextState);
            return nextState;
        });
    }

    async schedulePurge(updater: (state: AppState) => AppState): Promise<PurgeScheduleResult> {
        return this.enqueue(async () => {
            const currentState = await this.loadUnlocked(false);
            const nextState = updater(currentState);
            const transactionId = crypto.randomUUID();
            const journal: PersistedPurgeJournal = {
                version: 1,
                transactionId,
                before: this.createCandidate(currentState).state,
                after: this.createCandidate(nextState).state
            };
            const result = await commands.schedulePurgeTransaction(
                transactionId,
                JSON.stringify(journal, null, 2)
            );
            if (result.status === 'error') {
                throw new Error(result.error);
            }
            return {
                transactionId,
                state: nextState,
                message: result.data
            };
        });
    }

    private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
        const result = this.operationQueue.then(operation, operation);
        this.operationQueue = result.then(() => undefined, () => undefined);
        return result;
    }

    private async ensureDirectory(): Promise<void> {
        try {
            await mkdir('', { baseDir: this.baseDir, recursive: true });
        } catch (error) {
            if (!this.hasLoggedDirectoryError) {
                this.hasLoggedDirectoryError = true;
                console.error('Error ensuring directory:', error);
            }
            throw error;
        }
    }

    private async loadUnlocked(cleanupLegacyImages = true): Promise<AppState> {
        await this.ensureDirectory();

        const recoveredPurge = await this.recoverCompletedPurge();
        if (recoveredPurge) return recoveredPurge;

        let journal: ResolvedStateJournal | null = null;
        try {
            journal = await this.readPendingJournal();
        } catch (error) {
            console.error('[TauriFsRepository] Ignoring invalid settings journal and trying committed state:', error);
        }
        if (journal) {
            const recoveryCandidate = journal.phase === 'committed' ? journal.after : journal.before;
            console.warn(journal.phase === 'committed'
                ? '[TauriFsRepository] Materializing committed library.json write.'
                : '[TauriFsRepository] Rolling back interrupted library.json write.');
            await this.restoreCandidate(recoveryCandidate);
            return this.prepareLoadedState(recoveryCandidate.state);
        }

        const saved = await this.readCandidate(this.fileName);
        if (saved) {
            await this.removeCompletedJournalIfPresent();
            await this.ensureBackupExists(saved.content);
            const preparedState = this.prepareLoadedState(saved.state);

            if (cleanupLegacyImages
                && saved.state.images
                && Array.isArray(saved.state.images)
                && saved.state.images.length > 0) {
                console.log('[TauriFsRepository] Detected legacy images in library.json. Cleaning up to improve startup...');
                try {
                    await this.saveUnlocked(preparedState);
                } catch {
                    // The valid loaded state remains usable even when best-effort cleanup fails.
                }
            }

            return preparedState;
        }

        const backup = await this.readCandidate(this.backupFileName);
        if (backup) {
            console.warn('[TauriFsRepository] Recovering library.json from backup.');
            await this.restoreCandidate(backup);
            return this.prepareLoadedState(backup.state);
        }

        return this.getDefaultState();
    }

    private async recoverCompletedPurge(): Promise<AppState | null> {
        const journalExists = await exists(this.purgeJournalFileName, { baseDir: this.baseDir });
        const completionExists = await exists(this.purgeCompletionFileName, { baseDir: this.baseDir });
        if (!journalExists && !completionExists) return null;
        if (!journalExists || !completionExists) {
            throw new Error('Factory reset recovery artifacts are incomplete. They were preserved for startup recovery.');
        }

        let journal: PersistedPurgeJournal;
        let completion: PersistedCommitMarker;
        try {
            const parsedJournal: unknown = JSON.parse(await readTextFile(
                this.purgeJournalFileName,
                { baseDir: this.baseDir }
            ));
            const parsedCompletion: unknown = JSON.parse(await readTextFile(
                this.purgeCompletionFileName,
                { baseDir: this.baseDir }
            ));
            if (!isRecord(parsedJournal)
                || parsedJournal.version !== 1
                || typeof parsedJournal.transactionId !== 'string'
                || !this.isPersistedAppState(parsedJournal.before)
                || !this.isPersistedAppState(parsedJournal.after)
                || !isRecord(parsedCompletion)
                || parsedCompletion.version !== 1
                || parsedCompletion.transactionId !== parsedJournal.transactionId) {
                throw new Error('Factory reset recovery artifacts do not match.');
            }
            journal = parsedJournal as unknown as PersistedPurgeJournal;
            completion = parsedCompletion as unknown as PersistedCommitMarker;
        } catch (error) {
            throw new Error('Failed to validate factory reset recovery artifacts. They were preserved.', { cause: error });
        }

        const recoveredState = this.prepareLoadedState(journal.after);
        await this.saveUnlocked(recoveredState);
        try {
            await remove(this.purgeCompletionFileName, { baseDir: this.baseDir });
            await remove(this.purgeJournalFileName, { baseDir: this.baseDir });
        } catch (error) {
            console.warn('[TauriFsRepository] Factory reset was materialized, but recovery cleanup was incomplete:', {
                transactionId: completion.transactionId,
                error
            });
        }
        return recoveredState;
    }

    private async readPendingJournal(): Promise<ResolvedStateJournal | null> {
        try {
            if (!await exists(this.pendingFileName, { baseDir: this.baseDir })) return null;
        } catch (error) {
            if (isNotFoundFsError(error)) return null;
            throw new Error(`Failed to validate ${this.pendingFileName}. Recovery artifacts were preserved.`, { cause: error });
        }

        let content: string;
        try {
            content = await readTextFile(this.pendingFileName, { baseDir: this.baseDir });
        } catch (error) {
            throw new Error(`Failed to validate ${this.pendingFileName}. Recovery artifacts were preserved.`, { cause: error });
        }

        try {
            const parsed: unknown = JSON.parse(content);

            // Journals written before the explicit commit protocol represented a
            // completed save that only needed materialization.
            if (this.isPersistedAppState(parsed)) {
                const legacyCandidate = this.createCandidate(parsed);
                return {
                    phase: 'committed',
                    before: legacyCandidate,
                    after: legacyCandidate
                };
            }

            if (!isRecord(parsed)
                || parsed.version !== 1
                || typeof parsed.transactionId !== 'string'
                || (parsed.phase !== 'prepared' && parsed.phase !== 'committed')
                || !this.isPersistedAppState(parsed.before)
                || !this.isPersistedAppState(parsed.after)) {
                throw new Error('Persisted settings journal has an invalid shape.');
            }

            const commitMarker = await this.readCommitMarker();
            const phase = parsed.phase === 'committed'
                || commitMarker?.transactionId === parsed.transactionId
                ? 'committed'
                : 'prepared';

            return {
                phase,
                before: this.createCandidate(parsed.before),
                after: this.createCandidate(parsed.after)
            };
        } catch (error) {
            throw new Error(`Failed to validate ${this.pendingFileName}. Recovery artifacts were preserved.`, { cause: error });
        }
    }

    private async readCommitMarker(): Promise<PersistedCommitMarker | null> {
        try {
            if (!await exists(this.commitFileName, { baseDir: this.baseDir })) return null;
        } catch (error) {
            if (isNotFoundFsError(error)) return null;
            throw new Error(`Failed to validate ${this.commitFileName}. Recovery artifacts were preserved.`, { cause: error });
        }

        let content: string;
        try {
            content = await readTextFile(this.commitFileName, { baseDir: this.baseDir });
        } catch (error) {
            if (isNotFoundFsError(error)) return null;
            throw new Error(`Failed to validate ${this.commitFileName}. Recovery artifacts were preserved.`, { cause: error });
        }

        try {
            const parsed: unknown = JSON.parse(content);
            if (!isRecord(parsed)
                || parsed.version !== 1
                || typeof parsed.transactionId !== 'string'
                || parsed.transactionId.length === 0) {
                throw new Error('Persisted settings commit marker has an invalid shape.');
            }
            return {
                version: 1,
                transactionId: parsed.transactionId
            };
        } catch (error) {
            throw new Error(`Failed to validate ${this.commitFileName}. Recovery artifacts were preserved.`, { cause: error });
        }
    }

    private async readCandidate(fileName: string): Promise<PersistedStateCandidate | null> {
        try {
            if (!await exists(fileName, { baseDir: this.baseDir })) return null;
        } catch (error) {
            if (isNotFoundFsError(error)) return null;
            throw error;
        }

        let content: string;
        try {
            content = await readTextFile(fileName, { baseDir: this.baseDir });
        } catch (error) {
            if (isNotFoundFsError(error)) return null;
            throw error;
        }
        try {
            const state: unknown = JSON.parse(content);
            if (!this.isPersistedAppState(state)) {
                throw new Error('Persisted state has an invalid shape.');
            }
            return { content, state };
        } catch (error) {
            console.error(`[TauriFsRepository] Failed to read ${fileName}:`, error);
            return null;
        }
    }

    private isPersistedAppState(state: unknown): state is PersistedAppState {
        if (!isRecord(state)) return false;

        const candidate = state;
        return Array.isArray(candidate.images)
            && candidate.images.every(isRecord)
            && Array.isArray(candidate.collections)
            && candidate.collections.every(collection => isPersistedCollection(collection))
            && Array.isArray(candidate.smartCollections)
            && candidate.smartCollections.every(collection => isPersistedCollection(collection, true))
            && isPersistedSettings(candidate.settings)
            && isStringArray(candidate.recentSearches);
    }

    private prepareLoadedState(saved: PersistedAppState): AppState {
        const fallbackCreatedAt = Date.now();
        const prepareCollection = (collection: PersistedCollection): Collection => {
            const { filters, ...persistedFields } = collection;
            return {
                ...persistedFields,
                imageIds: collection.imageIds ?? [],
                createdAt: collection.createdAt ?? fallbackCreatedAt,
                ...(filters ? { filters: createDefaultFilters(filters) } : {})
            };
        };
        const prepareSmartCollection = (collection: PersistedSmartCollection): SmartCollection => ({
            ...collection,
            imageIds: collection.imageIds ?? [],
            createdAt: collection.createdAt ?? fallbackCreatedAt,
            filters: createDefaultFilters(collection.filters)
        });
        const savedSettings = saved.settings;
        const invokeDbSnapshot = savedSettings.invokeDbSnapshot
            ? {
                ...savedSettings.invokeDbSnapshot,
                pathRepairVersion: savedSettings.invokeDbSnapshot.pathRepairVersion ?? 0
            }
            : undefined;
        return {
            ...saved,
            images: [],
            collections: saved.collections.map(prepareCollection),
            smartCollections: saved.smartCollections.map(prepareSmartCollection),
            settings: createDefaultAppSettings({
                ...savedSettings,
                hasCompletedOnboarding: savedSettings.hasCompletedOnboarding ?? true,
                maskedKeywords: savedSettings.maskedKeywords ?? [],
                libraryShowGrids: savedSettings.libraryShowGrids ?? false,
                resourceFolders: savedSettings.resourceFolders ?? [],
                invokeDbSnapshot
            })
        };
    }

    private async saveUnlocked(state: AppState): Promise<void> {
        try {
            await this.ensureDirectory();
            const before = await this.readCommittedCandidate();
            const after = this.createCandidate(state);
            const transactionId = crypto.randomUUID();
            const preparedJournal: PersistedStateJournal = {
                version: 1,
                transactionId,
                phase: 'prepared',
                before: before.state,
                after: after.state
            };

            await writeTextFile(this.pendingFileName, JSON.stringify(preparedJournal, null, 2), { baseDir: this.baseDir });
            await writeTextFile(this.fileName, after.content, { baseDir: this.baseDir });
            await writeTextFile(this.backupFileName, after.content, { baseDir: this.baseDir });
            await writeTextFile(this.commitFileName, JSON.stringify({
                version: 1,
                transactionId
            } satisfies PersistedCommitMarker), { baseDir: this.baseDir });
            await this.removeCompletedJournalIfPresent();
        } catch (error) {
            console.error('Failed to save state to filesystem:', error);
            throw error;
        }
    }

    private async readCommittedCandidate(): Promise<PersistedStateCandidate> {
        const journal = await this.readPendingJournal();
        if (journal) {
            return journal.phase === 'committed' ? journal.after : journal.before;
        }

        const main = await this.readCandidate(this.fileName);
        if (main) return main;

        const backup = await this.readCandidate(this.backupFileName);
        if (backup) return backup;

        return this.createCandidate(this.getDefaultState());
    }

    private createCandidate(state: AppState | PersistedAppState): PersistedStateCandidate {
        const persistedState: PersistedAppState = {
            ...state,
            images: []
        };
        return {
            content: JSON.stringify(persistedState, null, 2),
            state: persistedState
        };
    }

    private async restoreCandidate(candidate: PersistedStateCandidate): Promise<void> {
        try {
            await writeTextFile(this.fileName, candidate.content, { baseDir: this.baseDir });
            await writeTextFile(this.backupFileName, candidate.content, { baseDir: this.baseDir });
            await this.removeCompletedJournalIfPresent();
        } catch (error) {
            console.error('[TauriFsRepository] Failed to restore recovered state:', error);
        }
    }

    private async ensureBackupExists(content: string): Promise<void> {
        try {
            if (!await exists(this.backupFileName, { baseDir: this.baseDir })) {
                await writeTextFile(this.backupFileName, content, { baseDir: this.baseDir });
            }
        } catch (error) {
            console.warn('[TauriFsRepository] Failed to create library.json backup:', error);
        }
    }

    private async removeCompletedJournalIfPresent(): Promise<void> {
        try {
            if (await exists(this.pendingFileName, { baseDir: this.baseDir })) {
                await remove(this.pendingFileName, { baseDir: this.baseDir });
            }
            if (await exists(this.commitFileName, { baseDir: this.baseDir })) {
                await remove(this.commitFileName, { baseDir: this.baseDir });
            }
        } catch (error) {
            console.warn('[TauriFsRepository] Failed to remove completed settings journal:', error);
        }
    }

    private getDefaultState(): AppState {
        return {
            images: [],
            collections: INITIAL_COLLECTIONS,
            smartCollections: [],
            settings: createDefaultAppSettings(),
            recentSearches: []
        };
    }
}
