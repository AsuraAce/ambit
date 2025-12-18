import JSZip from 'jszip';
import { AIImage } from '../types';

export const exportImagesToZip = async (images: AIImage[], zipFilename = 'export.zip'): Promise<void> => {
  const zip = new JSZip();
  const metadataFolder = zip.folder("metadata");

  // Create a global manifest
  const manifest = images.map(img => ({
    filename: img.filename,
    metadata: img.metadata,
    notes: img.notes
  }));
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  // Process images
  const promises = images.map(async (img) => {
    try {
      // Fetch the image data
      // Note: In a real app this would read from fs. 
      // Here we fetch from the URL (Picsum). 
      const response = await fetch(img.url);
      const blob = await response.blob();
      
      // Add image to root of zip
      zip.file(img.filename, blob);
      
      // Add individual metadata file
      if (metadataFolder) {
          metadataFolder.file(`${img.filename}.json`, JSON.stringify(img.metadata, null, 2));
      }
    } catch (err) {
      console.error(`Failed to download ${img.filename}`, err);
      zip.file(`${img.filename}.error.txt`, `Failed to download source image: ${img.url}`);
    }
  });

  await Promise.all(promises);

  // Generate and download
  const content = await zip.generateAsync({ type: "blob" });
  
  // Create download link
  const url = window.URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = zipFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};