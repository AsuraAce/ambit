import { commands, type A1111DiscoveryCandidate as BackendDiscoveryCandidate } from '../../bindings';
import { normalizePath } from '../../utils/pathUtils';
import { unwrap } from '../../utils/spectaUtils';
import { A1111FolderType, type DiscoveryCandidate, type DiscoveryResult, WebUIVariant } from './types';

const toFolderType = (value: string): A1111FolderType => {
    if ((Object.values(A1111FolderType) as string[]).includes(value)) {
        return value as A1111FolderType;
    }
    return A1111FolderType.UNKNOWN;
};

const toWebUIVariant = (value: string): WebUIVariant => {
    if ((Object.values(WebUIVariant) as string[]).includes(value)) {
        return value as WebUIVariant;
    }
    return WebUIVariant.UNKNOWN;
};

const normalizeExistingPaths = (existingPaths: Set<string>): Set<string> =>
    new Set(Array.from(existingPaths, path => normalizePath(path).toLowerCase()));

const mapBackendCandidate = (
    candidate: BackendDiscoveryCandidate,
    existingPaths: Set<string>,
    forcedVariant: WebUIVariant | 'Auto'
): DiscoveryCandidate => {
    const normalizedPath = normalizePath(candidate.path);
    const variant = forcedVariant === 'Auto'
        ? toWebUIVariant(candidate.variant)
        : forcedVariant;

    return {
        path: normalizedPath,
        name: candidate.name,
        imageCount: candidate.imageCount,
        inferredType: toFolderType(candidate.inferredType),
        isAlreadyLinked: existingPaths.has(normalizedPath.toLowerCase()),
        isPriority: candidate.isPriority,
        variant
    };
};

export const getUnlinkedPriorityCandidatePaths = (candidates: DiscoveryCandidate[]): string[] =>
    candidates
        .filter(candidate => candidate.isPriority && !candidate.isAlreadyLinked)
        .map(candidate => candidate.path);

/**
 * Attempts to detect the specific WebUI variant (A1111, Forge, SD.Next, Anapnoe).
 * This now goes through the backend discovery command so archive paths are not
 * limited by the frontend fs plugin scope.
 */
export const detectWebUIVariation = async (rootPath: string): Promise<WebUIVariant> => {
    const result = await unwrap(commands.discoverA1111Folders(rootPath));
    return toWebUIVariant(result.detectedVariant);
};

/**
 * Discover potential A1111/SD WebUI folders using the same recursive image rules
 * as the importer, then add frontend-only state such as linked status and manual
 * variant override.
 */
export const discoverA1111Candidates = async (
    rootPath: string,
    existingPaths: Set<string>,
    forcedVariant: WebUIVariant | 'Auto' = 'Auto'
): Promise<DiscoveryResult> => {
    const result = await unwrap(commands.discoverA1111Folders(rootPath));
    const normalizedExistingPaths = normalizeExistingPaths(existingPaths);
    const logs = [...result.logs];

    if (forcedVariant !== 'Auto') {
        logs.push(`[Info] Manual Override applied: Forced all candidates to ${forcedVariant}`);
    }

    return {
        detectedVariant: forcedVariant === 'Auto'
            ? toWebUIVariant(result.detectedVariant)
            : forcedVariant,
        candidates: result.candidates.map(candidate =>
            mapBackendCandidate(candidate, normalizedExistingPaths, forcedVariant)
        ),
        logs,
        warnings: [...result.warnings]
    };
};
