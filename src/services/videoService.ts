import { convertFileSrc } from '@tauri-apps/api/core';
import { commands, type VideoImportOutcome } from '../bindings';
import { normalizePath } from '../utils/pathUtils';
import { unwrap } from '../utils/spectaUtils';

const VIDEO_FILTER_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v', 'mkv'];

export interface VideoImportSummary {
    imported: number;
    duplicate: number;
    rejected: number;
    cancelled: number;
    posterFailures: number;
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
    shouldCancel?: () => boolean
): Promise<VideoImportSummary> => {
    const summary: VideoImportSummary = {
        imported: 0,
        duplicate: 0,
        rejected: 0,
        cancelled: 0,
        posterFailures: 0
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
            console.warn('[VideoImport] Failed to import video; continuing batch', path, error);
            if (shouldCancel?.()) break;
            continue;
        }
        countOutcome(summary, outcome);

        if (outcome.status === 'cancelled' || shouldCancel?.()) break;

        if (outcome.asset && outcome.status !== 'rejected' && outcome.status !== 'cancelled') {
            try {
                const poster = await captureVideoPoster(path, outcome.asset.durationMs);
                await unwrap(commands.storeVideoPoster(outcome.asset.id, poster));
            } catch (error) {
                summary.posterFailures += 1;
                console.warn('[VideoImport] Imported video without generated poster', path, error);
            }
        }
    }

    return summary;
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
    timeoutMs = 15_000
): Promise<void> => new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error(`Timed out waiting for ${successEvent}`)), timeoutMs);
    const finish = (error?: Error) => {
        window.clearTimeout(timeout);
        video.removeEventListener(successEvent, handleSuccess);
        video.removeEventListener('error', handleError);
        error ? reject(error) : resolve();
    };
    const handleSuccess = () => finish();
    const handleError = () => finish(new Error('Browser could not decode the video for poster generation'));
    video.addEventListener(successEvent, handleSuccess, { once: true });
    video.addEventListener('error', handleError, { once: true });
});

export const captureVideoPoster = async (path: string, durationMs: number): Promise<string> => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata';

    try {
        const metadataReady = waitForVideoEvent(video, 'loadedmetadata');
        video.src = convertFileSrc(normalizePath(path));
        await metadataReady;

        const knownDuration = Number.isFinite(video.duration) && video.duration > 0
            ? video.duration
            : durationMs / 1000;
        const seekTarget = Math.min(1, knownDuration * 0.1);
        if (seekTarget > 0) {
            const seeked = waitForVideoEvent(video, 'seeked');
            video.currentTime = seekTarget;
            await seeked;
        }

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
