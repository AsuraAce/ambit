
import { useMemo } from 'react';
import { AIImage, ModelType } from '../types';

export const useLibraryStats = (images: AIImage[]) => {
  
  const stats = useMemo(() => {
    const totalGenerations = images.length;
    const avgSteps = Math.round(images.reduce((acc, img) => acc + img.metadata.steps, 0) / (totalGenerations || 1));
    const estSizeMB = (totalGenerations * 2.4).toFixed(1);

    // Calculate Model Distribution
    const modelStats = Object.values(ModelType).map(modelName => {
        return {
          name: modelName.split(' ')[0], // Shorten name for axis
          fullName: modelName,
          count: images.filter(img => (img.metadata.overrideModel || img.metadata.model) === modelName).length
        };
    });

    return { totalGenerations, avgSteps, estSizeMB, modelStats };
  }, [images]);

  const wordCloud = useMemo(() => {
    const stopWords = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'with', 'and', 'or', 'for', 'to', 'is', 'are', 'style', 'by', 'view', 'highly', 'detailed', 'render', '4k', '8k', 'resolution', 'quality', 'masterpiece', 'best', 'score', 'rating', 'source', 'image', 'picture']);
    const counts: Record<string, number> = {};

    images.forEach(img => {
        // Basic tokenization
        const tokens = img.metadata.positivePrompt
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '') // remove punctuation
            .split(/\s+/);

        tokens.forEach(token => {
            if (token.length > 2 && !stopWords.has(token) && !token.startsWith('score_')) {
                counts[token] = (counts[token] || 0) + 1;
            }
        });
    });

    // Convert to array and sort
    return Object.entries(counts)
        .map(([text, value]) => ({ text, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 40); // Top 40
  }, [images]);

  return { ...stats, wordCloud };
};
