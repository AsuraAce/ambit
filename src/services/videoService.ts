import { convertFileSrc } from '@tauri-apps/api/core';
import { commands, type VideoAssetRecord, type VideoImportOutcome } from '../bindings';
import { GeneratorTool, type VideoAsset } from '../types';
import { getFilename, normalizePath } from '../utils/pathUtils';
import { unwrap } from '../utils/spectaUtils';

const VIDEO_FILTER_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v', 'mkv'];
const VIDEO_POSTER_CANCEL_POLL_MS = 50;

class VideoPosterCancelledError extends Error {
    constructor() {
        super('Video poster generation cancelled');
        this.name = 'VideoPosterCancelledError';
    }
}

export interface VideoImportSummary {
    imported: number;
    duplicate: number;
    rejected: number;
    cancelled: number;
    posterFailures: number;
    assets: VideoAsset[];
    handledPaths: string[];
    failedPaths: string[];
}

export const pickVideoPaths = async (): Promise<string[]> => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
        multiple: true,
        directory: false,
        filters: [{ name: 'Videos', extensions: VIDEO_FILTER_EXTENSIONS }]
    });
    return (Array.isArray(selected) ? selected : selected ? [selected] : [])
        .filter((path): path is string => typeof path === 'string')
        .map(normalizePath);
};

export const importVideoPaths = async (
    paths: string[],
    onOperationStarted?: (operationId: string) => void,
    shouldCancel?: () => boolean,
    onProgress?: (current: number, total: number) => void
): Promise<VideoImportSummary> => {
    const summary: VideoImportSummary = {
        imported: 0,
        duplicate: 0,
        rejected: 0,
        cancelled: 0,
        posterFailures: 0,
        assets: [],
        handledPaths: [],
        failedPaths: []
    };

    for (const path of paths) {
        if (shouldCancel?.()) break;
        const operationId = crypto.randomUUID();
        onOperationStarted?.(operationId);
        let outcome: VideoImportOutcome;
        try {
            outcome = await unwrap(commands.importVideoAsset(path, operationId));
        } catch (error) {
            summary.rejected += 1;
            summary.failedPaths.push(normalizePath(path));
            console.warn('[VideoImport] Failed to import video; continuing batch', path, error);
            onProgress?.(summary.handledPaths.length + summary.failedPaths.length + summary.cancelled, paths.length);
            if (shouldCancel?.()) break;
            continue;
        }
        countOutcome(summary, outcome);

        if (outcome.status === 'cancelled') {
            onProgress?.(summary.handledPaths.length + summary.failedPaths.length + summary.cancelled, paths.length);
            break;
        }
        let cancellationRequested = !!shouldCancel?.();

        if (outcome.status === 'rejected') {
            summary.handledPaths.push(normalizePath(path));
        }

        if (outcome.asset && outcome.status !== 'rejected' && outcome.status !== 'cancelled') {
            let thumbnailPath: string | undefined;
            if (!cancellationRequested && outcome.status !== 'duplicate') {
                try {
                    const poster = await captureVideoPoster(path, outcome.asset.durationMs, shouldCancel);
                    const stored = await unwrap(commands.storeVideoPoster(outcome.asset.id, poster));
                    thumbnailPath = stored.thumbnailPath;
                } catch (error) {
                    cancellationRequested = error instanceof VideoPosterCancelledError || !!shouldCancel?.();
                    if (!cancellationRequested) {
                        summary.posterFailures += 1;
                        console.warn('[VideoImport] Imported video without generated poster', path, error);
                    }
                }
            }
            summary.handledPaths.push(normalizePath(path));
            if (outcome.status !== 'duplicate') {
                summary.assets.push(mapVideoRecordToAsset(outcome.asset, thumbnailPath));
            }
        }
        onProgress?.(summary.handledPaths.length + summary.failedPaths.length + summary.cancelled, paths.length);
        if (cancellationRequested) break;
    }

    return summary;
};

const mapVideoRecordToAsset = (
    record: VideoAssetRecord,
    thumbnailPath?: string
): VideoAsset => {
    const normalizedPath = normalizePath(record.path);
    return {
        mediaType: 'video',
        id: record.id,
        url: convertFileSrc(normalizedPath),
        thumbnailUrl: thumbnailPath ? convertFileSrc(normalizePath(thumbnailPath)) : '',
        filename: getFilename(normalizedPath),
        fileSize: record.fileSize,
        timestamp: record.timestamp,
        width: record.width,
        height: record.height,
        isFavorite: false,
        isPinned: false,
        isDeleted: false,
        isMissing: false,
        isCorrupt: false,
        metadata: {
            tool: GeneratorTool.UNKNOWN,
            model: 'Unknown',
            steps: 0,
            cfg: 0,
            sampler: 'Unknown',
            positivePrompt: '',
            negativePrompt: '',
            generationType: 'unknown'
        },
        mediaContainer: record.mediaContainer ?? undefined,
        mediaMimeType: record.mediaMimeType ?? undefined,
        durationMs: record.durationMs,
        videoCodec: record.videoCodec,
        videoProfile: record.videoProfile ?? undefined,
        audioPresent: record.audioPresent,
        audioCodec: record.audioCodec ?? undefined,
        frameRateNum: record.frameRateNum ?? undefined,
        frameRateDen: record.frameRateDen ?? undefined,
        rotationDegrees: record.rotationDegrees as VideoAsset['rotationDegrees'],
        probeStatus: 'ready',
        playbackStatus: 'unknown'
    };
};

export const cancelVideoImport = async (operationId: string): Promise<boolean> =>
    unwrap(commands.cancelVideoImport(operationId));

const countOutcome = (summary: VideoImportSummary, outcome: VideoImportOutcome) => {
    if (outcome.status === 'imported' || outcome.status === 'updated') summary.imported += 1;
    else if (outcome.status === 'duplicate') summary.duplicate += 1;
    else if (outcome.status === 'cancelled') summary.cancelled += 1;
    else summary.rejected += 1;
};

const waitForVideoEvent = (
    video: HTMLVideoElement,
    successEvent: 'loadedmetadata' | 'seeked',
    timeoutMs = 15_000,
    shouldCancel?: () => boolean
): Promise<void> => new Promise((resolve, reject) => {
    let timeout: number | undefined;
    let cancellationPoll: number | undefined;
    let settled = false;
    const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) window.clearTimeout(timeout);
        if (cancellationPoll !== undefined) window.clearInterval(cancellationPoll);
        video.removeEventListener(successEvent, handleSuccess);
        video.removeEventListener('error', handleError);
        error ? reject(error) : resolve();
    };
    const handleSuccess = () => finish();
    const handleError = () => finish(new Error('Browser could not decode the video for poster generation'));
    video.addEventListener(successEvent, handleSuccess, { once: true });
    video.addEventListener('error', handleError, { once: true });
    if (shouldCancel?.()) {
        finish(new VideoPosterCancelledError());
        return;
    }
    timeout = window.setTimeout(() => finish(new Error(`Timed out waiting for ${successEvent}`)), timeoutMs);
    if (shouldCancel) {
        cancellationPoll = window.setInterval(() => {
            if (shouldCancel()) finish(new VideoPosterCancelledError());
        }, VIDEO_POSTER_CANCEL_POLL_MS);
    }
});

export const captureVideoPoster = async (
    path: string,
    durationMs: number,
    shouldCancel?: () => boolean
): Promise<string> => {
    if (shouldCancel?.()) throw new VideoPosterCancelledError();
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata';

    try {
        const metadataReady = waitForVideoEvent(video, 'loadedmetadata', 15_000, shouldCancel);
        video.src = convertFileSrc(normalizePath(path));
        await metadataReady;
        if (shouldCancel?.()) throw new VideoPosterCancelledError();

        const knownDuration = Number.isFinite(video.duration) && video.duration > 0
            ? video.duration
            : durationMs / 1000;
        const seekTarget = Math.min(1, knownDuration * 0.1);
        if (seekTarget > 0) {
            const seeked = waitForVideoEvent(video, 'seeked', 15_000, shouldCancel);
            video.currentTime = seekTarget;
            await seeked;
        }
        if (shouldCancel?.()) throw new VideoPosterCancelledError();

        const scale = Math.min(1, 512 / video.videoWidth, 512 / video.videoHeight);
        const width = Math.max(1, Math.round(video.videoWidth * scale));
        const height = Math.max(1, Math.round(video.videoHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas is unavailable for video poster generation');
        context.drawImage(video, 0, 0, width, height);
        return canvas.toDataURL('image/webp', 0.82);
    } finally {
        video.removeAttribute('src');
        video.load();
    }
};
