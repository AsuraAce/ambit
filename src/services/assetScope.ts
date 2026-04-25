import { appLocalDataDir } from '@tauri-apps/api/path';
import { commands } from '../bindings';
import { AppSettings } from '../types';
import {
    getDirectoryPath,
    isPathWithinDirectory,
    normalizeInvokeRoot,
    normalizePath,
    urlToPath,
} from '../utils/pathUtils';
import { isBrowserMockMode } from './runtime';

const registeredDirectories = new Map<string, Promise<void>>();
let appLocalDataPromise: Promise<string | null> | null = null;

const getAppLocalDataPath = async (): Promise<string | null> => {
    if (isBrowserMockMode()) return null;

    if (!appLocalDataPromise) {
        appLocalDataPromise = appLocalDataDir()
            .then((path) => normalizePath(path))
            .catch((error) => {
                console.error('[AssetScope] Failed to resolve AppLocalData directory', error);
                return null;
            });
    }

    return appLocalDataPromise;
};

const isRemoteUrl = (value: string): boolean =>
    /^https?:\/\//i.test(value) &&
    !/^https?:\/\/(?:asset|tauri)\.localhost(?::\d+)?\//i.test(value) &&
    !/^https?:\/\/localhost(?::\d+)?\/_up_\//i.test(value);

const resolveLocalPath = (input: string | null | undefined): string | null => {
    if (!input) return null;
    if (input.startsWith('data:') || input.startsWith('blob:')) return null;
    if (isRemoteUrl(input)) return null;

    const normalized = input.includes('://') ? urlToPath(input) : normalizePath(input);
    if (!normalized) return null;

    if (/^[a-z]+:/i.test(normalized) && !/^[A-Za-z]:\//.test(normalized)) {
        return null;
    }

    return normalized;
};

export const ensureAssetPathAccessible = async (
    input: string | null | undefined,
    options?: { assumeDirectory?: boolean }
): Promise<void> => {
    if (isBrowserMockMode()) return;

    const resolvedPath = resolveLocalPath(input);
    if (!resolvedPath) return;

    const appLocalDataPath = await getAppLocalDataPath();
    if (appLocalDataPath && isPathWithinDirectory(resolvedPath, appLocalDataPath)) {
        return;
    }

    const targetDirectory = normalizePath(
        options?.assumeDirectory ? resolvedPath : getDirectoryPath(resolvedPath)
    );

    if (!targetDirectory) return;

    const cacheKey = targetDirectory.toLowerCase();
    const existing = registeredDirectories.get(cacheKey);
    if (existing) {
        await existing;
        return;
    }

    const registration = commands.registerLibraryPath(targetDirectory)
        .then((result) => {
            if (result.status === 'error') {
                throw new Error(result.error);
            }
        })
        .catch((error) => {
            registeredDirectories.delete(cacheKey);
            console.error(`[AssetScope] Failed to register path scope for ${targetDirectory}`, error);
            throw error;
        });

    registeredDirectories.set(cacheKey, registration);
    await registration;
};

export const ensureConfiguredAssetPathsAccessible = async (
    settings: Pick<AppSettings, 'monitoredFolders' | 'invokeAiPath'>
): Promise<void> => {
    const tasks: Promise<void>[] = settings.monitoredFolders.map((folder) =>
        ensureAssetPathAccessible(folder.path, { assumeDirectory: true })
    );

    const invokeRoot = normalizeInvokeRoot(settings.invokeAiPath);
    if (invokeRoot) {
        tasks.push(ensureAssetPathAccessible(invokeRoot, { assumeDirectory: true }));
    }

    await Promise.allSettled(tasks);
};
