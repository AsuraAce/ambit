import { readFile } from '@tauri-apps/plugin-fs';

const ANALYSIS_MAX_EDGE = 2048;
const ANALYSIS_MIME_TYPE = 'image/webp';

const getImageMimeType = (path: string): string => {
    const extension = path.split(/[?#]/, 1)[0].split('.').pop()?.toLowerCase();
    switch (extension) {
        case 'jpg':
        case 'jpeg':
            return 'image/jpeg';
        case 'webp':
            return 'image/webp';
        case 'gif':
            return 'image/gif';
        case 'avif':
            return 'image/avif';
        default:
            return 'image/png';
    }
};

const dataUrlToBlob = (url: string): Blob => {
    const match = /^data:([^;,]+)(?:;[^,]*)?;base64,([a-z0-9+/=\s]+)$/i.exec(url);
    if (!match || !match[1].startsWith('image/')) {
        throw new Error('Analysis image must be a base64-encoded image data URL');
    }

    const binary = atob(match[2].replace(/\s/g, ''));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new Blob([bytes], { type: match[1] });
};

const loadSourceBlob = async (url: string): Promise<Blob> => {
    let blob: Blob;
    if (url.startsWith('data:')) {
        blob = dataUrlToBlob(url);
    } else if (url.startsWith('http') || url.startsWith('blob:')) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Unable to load analysis image (${response.status})`);
        }
        blob = await response.blob();
    } else {
        const data = await readFile(url);
        blob = new Blob([data], { type: getImageMimeType(url) });
    }

    if (!blob.type.startsWith('image/')) {
        throw new Error('Analysis source is not an image');
    }
    return blob;
};

const scaledDimensions = (width: number, height: number): { width: number; height: number } => {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error('Analysis image has invalid dimensions');
    }
    const scale = Math.min(1, ANALYSIS_MAX_EDGE / Math.max(width, height));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
};

const blobToDataUrl = async (blob: Blob): Promise<string> => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return `data:${ANALYSIS_MIME_TYPE};base64,${btoa(binary)}`;
};

const canvasToWebp = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
        if (!blob || blob.type !== ANALYSIS_MIME_TYPE) {
            reject(new Error('Browser could not create a sanitized WebP analysis image'));
            return;
        }
        resolve(blob);
    }, ANALYSIS_MIME_TYPE, 0.9);
});

const drawBitmap = async (blob: Blob, canvas: HTMLCanvasElement): Promise<void> => {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    try {
        const dimensions = scaledDimensions(bitmap.width, bitmap.height);
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Browser cannot create an analysis canvas');
        context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    } finally {
        bitmap.close();
    }
};

const drawImageElement = async (blob: Blob, canvas: HTMLCanvasElement): Promise<void> => {
    const objectUrl = URL.createObjectURL(blob);
    try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error('Browser could not decode the analysis image'));
            element.src = objectUrl;
        });
        const dimensions = scaledDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height);
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Browser cannot create an analysis canvas');
        context.drawImage(image, 0, 0, dimensions.width, dimensions.height);
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
};

/**
 * Decodes an image to pixels and re-encodes it before an external AI request.
 * The result is orientation-aware, bounded to 2048px, and cannot carry source
 * EXIF, GPS, XMP, or comment blocks because no original container bytes survive.
 */
export const imageToAnalysisBase64 = async (url: string): Promise<string> => {
    const blob = await loadSourceBlob(url);
    const canvas = document.createElement('canvas');
    if (typeof createImageBitmap === 'function') {
        await drawBitmap(blob, canvas);
    } else {
        await drawImageElement(blob, canvas);
    }
    return blobToDataUrl(await canvasToWebp(canvas));
};

/**
 * Repairs asset URLs for Tauri compatibility.
 */
export const repairAssetUrl = (url: string): string => {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:')) return url;
    return url;
};
