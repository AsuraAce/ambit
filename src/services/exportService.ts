import JSZip from 'jszip';
import { AIImage, isVideoAsset } from '../types';
import { writeFile, readFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

export const exportImagesToZip = async (
  images: AIImage[],
  destinationFolder: string,
  zipFilename: string,
  onProgress?: (current: number, total: number) => void
): Promise<void> => {
  const zip = new JSZip();
  const metadataFolder = zip.folder("metadata")!;

  // Create a global manifest
  const manifest = images.map(img => ({
    filename: img.filename,
    mediaType: img.mediaType ?? 'image',
    metadata: img.metadata,
    notes: img.notes,
    ...(isVideoAsset(img) ? {
      video: {
        container: img.mediaContainer,
        mimeType: img.mediaMimeType,
        durationMs: img.durationMs,
        videoCodec: img.videoCodec,
        videoProfile: img.videoProfile,
        audioPresent: img.audioPresent,
        audioCodec: img.audioCodec,
        frameRateNum: img.frameRateNum,
        frameRateDen: img.frameRateDen,
        rotationDegrees: img.rotationDegrees,
        probeStatus: img.probeStatus,
        playbackStatus: img.playbackStatus,
      }
    } : {})
  }));
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const total = images.length;
  let count = 0;

  // Process library items. Raw reads are binary-safe for images and videos.
  const processItem = async (img: AIImage) => {
    try {
      // Read raw file content using Tauri's FS plugin
      const data = await readFile(img.id);

      // Add the original media file to the root of the ZIP.
      zip.file(img.filename, data);

      // Add individual metadata file
      metadataFolder.file(`${img.filename}.json`, JSON.stringify(img.metadata, null, 2));
    } catch (err) {
      console.error(`Failed to read file ${img.filename}`, err);
      // Fallback: try fetching if URL is http/blob (unlikely for local files but safe)
      if (img.url.startsWith('http') || img.url.startsWith('blob:') || img.url.startsWith('data:')) {
        try {
          const response = await fetch(img.url);
          const blob = await response.blob();
          zip.file(img.filename, blob);
        } catch (e) {
          zip.file(`${img.filename}.error.txt`, `Failed to download source item: ${img.url}`);
        }
      } else {
        zip.file(`${img.filename}.error.txt`, `Failed to read local file: ${img.id}`);
      }
    } finally {
      count++;
      if (onProgress) onProgress(count, total);
    }
  };

  let nextIndex = 0;
  const workerCount = Math.min(4, total);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < total) {
      const index = nextIndex;
      nextIndex += 1;
      await processItem(images[index]);
    }
  }));

  // Generate ZIP content as Uint8Array
  const content = await zip.generateAsync({ type: "uint8array" });

  // Save natively using Tauri
  const finalPath = await join(destinationFolder, zipFilename.endsWith('.zip') ? zipFilename : `${zipFilename}.zip`);
  await writeFile(finalPath, content);
};
