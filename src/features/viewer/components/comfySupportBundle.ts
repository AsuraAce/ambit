import type { ComfyParserDiagnosticsReport } from '../../../bindings';
import type { AIImage } from '../../../types';

type SupportImage = Pick<AIImage, 'filename' | 'width' | 'height'>;

const describeImage = (image: SupportImage) => {
    const extension = image.filename.match(/\.([^.]+)$/)?.[1]?.toLowerCase();

    return {
        format: extension || 'unknown',
        width: image.width,
        height: image.height
    };
};

const sortChunks = (chunks: Record<string, string>) =>
    Object.fromEntries(
        Object.entries(chunks).sort(([left], [right]) => left.localeCompare(right))
    ) as Record<string, string>;

const getChunkLengths = (chunks: Record<string, string>) =>
    Object.fromEntries(
        Object.entries(chunks).map(([key, value]) => [key, value.length])
    ) as Record<string, number>;

export const buildDiagnosticsClipboardPayload = (
    image: SupportImage,
    chunks: Record<string, string>,
    diagnostics: ComfyParserDiagnosticsReport
) => {
    const sortedChunks = sortChunks(chunks);

    return {
        appVersion: diagnostics.appVersion,
        parserVersion: diagnostics.parserVersion,
        image: describeImage(image),
        chunkKeys: Object.keys(sortedChunks),
        chunkLengths: getChunkLengths(sortedChunks),
        graphNodeCount: diagnostics.graphNodeCount,
        outputSelection: {
            selectedOutputCandidateCount: diagnostics.selectedOutputCandidateCount,
            uniqueOutputRootSamplerCount: diagnostics.uniqueOutputRootSamplerCount,
            ambiguous: diagnostics.outputAmbiguous
        },
        attemptedLayers: diagnostics.attemptedLayers,
        fieldSources: diagnostics.fieldSources,
        fieldSourceNodeIds: diagnostics.fieldSourceNodeIds,
        resourceSources: diagnostics.resourceSources,
        traversalIssues: diagnostics.traversalIssues,
        traversalIssuesTruncated: diagnostics.traversalIssuesTruncated,
        metadata: diagnostics.metadata
    };
};

export const buildComfySupportBundle = (
    image: SupportImage,
    chunks: Record<string, string>,
    diagnostics: ComfyParserDiagnosticsReport,
    createdAt: string
) => {
    const sortedChunks = sortChunks(chunks);

    return {
        schemaVersion: 1,
        createdAt,
        appVersion: diagnostics.appVersion,
        parserVersion: diagnostics.parserVersion,
        image: describeImage(image),
        diagnostics,
        chunkLengths: getChunkLengths(sortedChunks),
        chunks: sortedChunks
    };
};
