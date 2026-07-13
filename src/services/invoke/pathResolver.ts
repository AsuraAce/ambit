import { getFilename, normalizePath } from '../../utils/pathUtils';

export interface ResolvedInvokeImagePath {
    absolutePath: string | null;
    relativePath: string | null;
    ambiguous: boolean;
}

interface InvokeDiskIndex {
    byRootRelative: Map<string, string>;
    byImagesRelative: Map<string, string>;
    byBasename: Map<string, string | null>;
}

const OUTPUT_IMAGES_PREFIX = 'outputs/images/';

const unresolvedPath = (): ResolvedInvokeImagePath => ({
    absolutePath: null,
    relativePath: null,
    ambiguous: false
});

const isOutputImagesRelative = (path: string): boolean =>
    path.toLowerCase().startsWith(OUTPUT_IMAGES_PREFIX);

const hasPathSeparator = (path: string): boolean => /[\\/]/.test(path);

const isUnsafePathInput = (path: string): boolean =>
    /^[\\/]/.test(path) || /^[A-Za-z]:/.test(path) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path);

const normalizeSafeRelativePath = (path: string | null | undefined): string | null => {
    const raw = (path || '').trim();
    if (!raw || isUnsafePathInput(raw)) return null;

    const normalized = normalizePath(raw).replace(/\/+$/, '');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.some(part => part === '.' || part === '..')) return null;

    return parts.join('/');
};

const joinRelativePath = (...parts: string[]): string =>
    parts
        .map(part => normalizeSafeRelativePath(part)!)
        .filter(Boolean)
        .join('/');

const toRootRelativeImagePath = (imageName: string): string => {
    return isOutputImagesRelative(imageName)
        ? imageName
        : `${OUTPUT_IMAGES_PREFIX}${imageName}`;
};

const toSubfolderImagePath = (imageName: string, imageSubfolder: string): string => {
    const filename = getFilename(imageName);
    const normalizedSubfolder = isOutputImagesRelative(imageSubfolder)
        ? imageSubfolder.slice(OUTPUT_IMAGES_PREFIX.length)
        : imageSubfolder;
    return `${OUTPUT_IMAGES_PREFIX}${joinRelativePath(normalizedSubfolder, filename)}`;
};

const fromOutputImagesRelative = (rootRelativePath: string): string | null => {
    const normalized = normalizeSafeRelativePath(rootRelativePath)!;

    return isOutputImagesRelative(normalized)
        ? normalized.slice(OUTPUT_IMAGES_PREFIX.length)
        : null;
};

const toAbsolutePath = (invokeRoot: string, rootRelativePath: string): string =>
    normalizePath(`${invokeRoot}/${normalizeSafeRelativePath(rootRelativePath)!}`);

export const buildInvokeImageDiskIndex = (files: string[]): InvokeDiskIndex => {
    const byRootRelative = new Map<string, string>();
    const byImagesRelative = new Map<string, string>();
    const byBasename = new Map<string, string | null>();

    files.forEach((file) => {
        const rootRelative = normalizeSafeRelativePath(file);
        if (!rootRelative) return;

        byRootRelative.set(rootRelative.toLowerCase(), rootRelative);

        const imagesRelative = fromOutputImagesRelative(rootRelative);
        if (imagesRelative) {
            byImagesRelative.set(imagesRelative.toLowerCase(), rootRelative);
        }

        const basename = getFilename(rootRelative).toLowerCase();

        if (!byBasename.has(basename)) {
            byBasename.set(basename, rootRelative);
            return;
        }

        if (byBasename.get(basename) !== rootRelative) {
            byBasename.set(basename, null);
        }
    });

    return { byRootRelative, byImagesRelative, byBasename };
};

export const createInvokeImagePathResolver = (
    invokeRoot: string,
    listImages: () => Promise<string[]>
) => {
    const normalizedRoot = normalizePath(invokeRoot).replace(/\/$/, '');
    let diskIndexPromise: Promise<InvokeDiskIndex> | null = null;

    const getDiskIndex = async (): Promise<InvokeDiskIndex> => {
        if (!diskIndexPromise) {
            diskIndexPromise = listImages().then(buildInvokeImageDiskIndex);
        }
        return diskIndexPromise;
    };

    const resolveImagePath = async (
        imageName: string,
        imageSubfolder?: string | null
    ): Promise<ResolvedInvokeImagePath> => {
        const normalizedName = normalizeSafeRelativePath(imageName);
        const rawSubfolder = (imageSubfolder || '').trim();
        const normalizedSubfolder = rawSubfolder ? normalizeSafeRelativePath(rawSubfolder) : '';
        if (!normalizedName || normalizedSubfolder === null) {
            console.warn('[InvokeAI Sync] Unsafe image path in InvokeAI database row; skipping.', {
                imageName,
                imageSubfolder
            });
            return unresolvedPath();
        }

        const directRelativePath = normalizedSubfolder
            ? toSubfolderImagePath(normalizedName, normalizedSubfolder)
            : toRootRelativeImagePath(normalizedName);
        const fallbackRelativePath = directRelativePath;
        const fallback: ResolvedInvokeImagePath = {
            absolutePath: toAbsolutePath(normalizedRoot, fallbackRelativePath),
            relativePath: fallbackRelativePath,
            ambiguous: false
        };

        if (normalizedSubfolder || hasPathSeparator(normalizedName)) {
            return fallback;
        }

        try {
            const index = await getDiskIndex();
            const rootRelativeMatch = index.byRootRelative.get(fallbackRelativePath.toLowerCase());
            const imagesRelativeMatch = index.byImagesRelative.get(normalizedName.toLowerCase());
            const exactMatch = rootRelativeMatch ?? imagesRelativeMatch;

            if (exactMatch) {
                return {
                    absolutePath: toAbsolutePath(normalizedRoot, exactMatch),
                    relativePath: exactMatch,
                    ambiguous: false
                };
            }

            const basenameMatch = index.byBasename.get(normalizedName.toLowerCase());
            if (basenameMatch === null) {
                console.warn('[InvokeAI Sync] Ambiguous image basename; skipping DB row to avoid importing the wrong file.', {
                    imageName
                });
                return { absolutePath: null, relativePath: null, ambiguous: true };
            }

            if (basenameMatch) {
                return {
                    absolutePath: toAbsolutePath(normalizedRoot, basenameMatch),
                    relativePath: basenameMatch,
                    ambiguous: false
                };
            }
        } catch (error) {
            console.warn('[InvokeAI Sync] Failed to build InvokeAI image path index; falling back to flat path resolution.', error);
        }

        return fallback;
    };

    const getThumbnailPathCandidates = (
        thumbnailName: string | null | undefined,
        resolvedImage: ResolvedInvokeImagePath
    ): string[] => {
        if (!resolvedImage.absolutePath) return [];
        const imagesRelative = resolvedImage.relativePath
            ? fromOutputImagesRelative(resolvedImage.relativePath)
            : null;
        const imageParent = imagesRelative?.split('/').slice(0, -1).join('/') ?? '';
        const imageBasename = imagesRelative ? getFilename(imagesRelative) : getFilename(resolvedImage.absolutePath);
        const fallbackThumbnailName = imageBasename.replace(/\.[^/.]+$/, '.webp');

        const normalizedThumbnail = normalizeSafeRelativePath(thumbnailName) ?? normalizeSafeRelativePath(fallbackThumbnailName);
        if (!normalizedThumbnail) return [];

        const candidates: string[] = [];
        const addCandidate = (rootRelative: string) => {
            const absolute = toAbsolutePath(normalizedRoot, rootRelative);
            if (!candidates.includes(absolute)) candidates.push(absolute);
        };

        if (hasPathSeparator(normalizedThumbnail)) {
            addCandidate(isOutputImagesRelative(normalizedThumbnail)
                ? normalizedThumbnail
                : `${OUTPUT_IMAGES_PREFIX}${normalizedThumbnail}`);
            return candidates;
        }

        if (imageParent) {
            addCandidate(`${OUTPUT_IMAGES_PREFIX}${imageParent}/${normalizedThumbnail}`);
            addCandidate(`${OUTPUT_IMAGES_PREFIX}${imageParent}/thumbnails/${normalizedThumbnail}`);
            addCandidate(`${OUTPUT_IMAGES_PREFIX}thumbnails/${imageParent}/${normalizedThumbnail}`);
        }

        addCandidate(`${OUTPUT_IMAGES_PREFIX}thumbnails/${normalizedThumbnail}`);
        return candidates;
    };

    const resolveThumbnailPath = (
        thumbnailName: string | null | undefined,
        resolvedImage: ResolvedInvokeImagePath,
        existingPaths?: ReadonlySet<string>
    ): string | null => {
        if (!resolvedImage.absolutePath) return null;
        const candidates = getThumbnailPathCandidates(thumbnailName, resolvedImage);
        if (existingPaths) {
            return candidates.find(candidate => existingPaths.has(candidate)) || resolvedImage.absolutePath;
        }

        return candidates[0] || resolvedImage.absolutePath;
    };

    const getLegacyFlatImagePath = (imageName: string): string | null => {
        const normalizedName = normalizeSafeRelativePath(imageName);
        if (!normalizedName) return null;

        return toAbsolutePath(normalizedRoot, `${OUTPUT_IMAGES_PREFIX}${getFilename(normalizedName)}`);
    };

    return { resolveImagePath, resolveThumbnailPath, getThumbnailPathCandidates, getLegacyFlatImagePath };
};
