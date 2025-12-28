import JSZip from 'jszip';
import { AIImage } from '../types';
import { writeFile, readFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

export const exportImagesToZip = async (
  images: AIImage[],
  destinationFolder: string,
  zipFilename: string,
  onProgress?: (current: number, total: number) => void
): Promise<void> => {
  const zip = new JSZip();
  const metadataFolder = zip.folder("metadata");

  // Create a global manifest
  const manifest = images.map(img => ({
    filename: img.filename,
    metadata: img.metadata,
    notes: img.notes
  }));
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const total = images.length;
  let count = 0;

  // Process images
  const promises = images.map(async (img) => {
    try {
      // Read raw file content using Tauri's FS plugin
      const data = await readFile(img.id);

      // Add image to root of zip
      zip.file(img.filename, data);

      // Add individual metadata file
      if (metadataFolder) {
        metadataFolder.file(`${img.filename}.json`, JSON.stringify(img.metadata, null, 2));
      }
    } catch (err) {
      console.error(`Failed to read file ${img.filename}`, err);
      // Fallback: try fetching if URL is http/blob (unlikely for local files but safe)
      if (img.url.startsWith('http') || img.url.startsWith('blob:') || img.url.startsWith('data:')) {
        try {
          const response = await fetch(img.url);
          const blob = await response.blob();
          zip.file(img.filename, blob);
        } catch (e) {
          zip.file(`${img.filename}.error.txt`, `Failed to download source image: ${img.url}`);
        }
      } else {
        zip.file(`${img.filename}.error.txt`, `Failed to read local file: ${img.id}`);
      }
    } finally {
      count++;
      if (onProgress) onProgress(count, total);
    }
  });

  await Promise.all(promises);

  // Generate ZIP content as Uint8Array
  const content = await zip.generateAsync({ type: "uint8array" });

  // Save natively using Tauri
  const finalPath = await join(destinationFolder, zipFilename.endsWith('.zip') ? zipFilename : `${zipFilename}.zip`);
  await writeFile(finalPath, content);
};