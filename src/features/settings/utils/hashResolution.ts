import type { ResolutionResult } from '../../../bindings';

export type HashResolutionCounts = ResolutionResult;

export const isHashResolutionPartial = (result: HashResolutionCounts): boolean => (
    result.failedCount > 0 || result.unknownCount > 0
);

export const formatHashResolutionMessage = (result: HashResolutionCounts): string => (
    `Resolution: ${result.resolvedCount} verified online, ${result.harvestedCount} harvested locally, ` +
    `${result.failedCount} failed online, ${result.namedFallbackCount} named fallback, ${result.unknownCount} unknown.`
);
