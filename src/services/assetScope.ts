import { appLocalDataDir } from '@tauri-apps/api/path';
import { commands, type LibraryGrantKind } from '../bindings';
import { getDirectoryPath, isPathWithinDirectory, normalizePath, urlToPath } from '../utils/pathUtils';
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

    const targetDirectory = normalizePath(options?.assumeDirectory ? resolvedPath : getDirectoryPath(resolvedPath));

    if (!targetDirectory) return;

    const cacheKey = targetDirectory.toLowerCase();
    const existing = registeredDirectories.get(cacheKey);
    if (existing) {
        await existing;
        return;
    }

    const registration = commands
        .registerLibraryPath(targetDirectory)
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
 * Rust grants it only when the user granted it, or a folder around it, in
 * Settings or a picker. Returns false when the folder is not granted or does not
 * exist; the failure is already logged.
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

/**
 * Asks Rust to record a folder the user named, for example by typing it. Rust
 * records a folder that is already granted, or inside one, without asking, and
 * otherwise shows a native confirmation. Returns whether the folder is granted.
 */
export const requestLibraryFolderGrant = async (path: string, kind: LibraryGrantKind): Promise<boolean> => {
    if (isBrowserMockMode()) return true;
    const result = await commands.requestLibraryFolderGrant(path, kind);
    if (result.status === 'error') throw new Error(result.error);
    return result.data;
};

/** Opens a native folder picker from Rust, which records the picked folder. */
export const pickLibraryFolder = async (kind: LibraryGrantKind, title?: string): Promise<string | null> => {
    const result = await commands.pickLibraryFolder(kind, title ?? null);
    if (result.status === 'error') throw new Error(result.error);
    return result.data;
};

/** Opens a native file picker from Rust, which records each picked file. */
export const pickLibraryFiles = async (filterName: string, extensions: string[]): Promise<string[]> => {
    const result = await commands.pickLibraryFiles(filterName, extensions);
    if (result.status === 'error') throw new Error(result.error);
    return result.data;
};

/** Drops a folder grant when the user removes the folder from Settings. */
export const revokeLibraryGrant = async (path: string, kind: LibraryGrantKind): Promise<void> => {
    if (isBrowserMockMode()) return;
    const result = await commands.revokeLibraryGrant(path, kind);
    if (result.status === 'error') throw new Error(result.error);
};

/**
 * Waits until Rust has granted the folders and files the user granted before,
 * which it does at every start. Library images load only after this, because the
 * webview cannot grant settings folders itself. A failed wait is logged and does
 * not block the app; folders that were not granted just stay unreadable.
 */
export const waitForLibraryGrants = async (): Promise<void> => {
    if (isBrowserMockMode()) return;
    try {
        const result = await commands.waitForLibraryGrants();
        if (result.status === 'error') throw new Error(result.error);
    } catch (error) {
        console.error('[AssetScope] Failed to wait for library grants', error);
    }
};
