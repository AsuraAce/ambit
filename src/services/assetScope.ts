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

/**
 * Registers a folder before a command that checks the filesystem scope reads it.
 * Returns false when the folder cannot be registered, for example because it does
 * not exist; the failure is already logged. The Rust command stays the decision point.
 */
export const ensureFolderAccessible = async (path: string | null | undefined): Promise<boolean> => {
    try {
        await ensureAssetPathAccessible(path, { assumeDirectory: true });
        return true;
    } catch {
        return false;
    }
};

/** Registers each folder and returns those now in scope, in their original order. */
export const filterAccessibleFolders = async (paths: string[]): Promise<string[]> => {
    const accessible = await Promise.all(paths.map(ensureFolderAccessible));
    return paths.filter((_, index) => accessible[index]);
};

export const ensureConfiguredAssetPathsAccessible = async (
    settings: Pick<AppSettings, 'monitoredFolders' | 'invokeAiPath' | 'resourceFolders'>
): Promise<void> => {
    const tasks: Promise<void>[] = settings.monitoredFolders.map((folder) =>
        ensureAssetPathAccessible(folder.path, { assumeDirectory: true })
    );

    settings.resourceFolders?.forEach((folder) => {
        tasks.push(ensureAssetPathAccessible(folder, { assumeDirectory: true }));
    });

    const invokeRoot = normalizeInvokeRoot(settings.invokeAiPath);
    if (invokeRoot) {
        tasks.push(ensureAssetPathAccessible(invokeRoot, { assumeDirectory: true }));
    }

    await Promise.allSettled(tasks);
};
