
import { AIImage, GeneratorTool } from '../../types';
import { insertImagesBatch } from '../../services/db/imageRepo';

/**
 * Generates and inserts a large number of mock images for stress testing.
 */
export const generateStressTestData = async (
    count: number,
    onProgress?: (current: number, total: number) => void
) => {
    const CHUNK_SIZE = 1000;
    const models = ['Stable Diffusion XL', 'SD 1.5', 'Midjourney v6', 'DALL-E 3', 'Flux.1'];
    const tags = ['nature', 'portrait', 'scifi', 'architecture', 'abstract', 'character', 'landscape'];
    const samplers = ['Euler a', 'DPM++ 2M Karras', 'UniPC', 'LMS'];

    let totalGenerated = 0;

    for (let i = 0; i < count; i += CHUNK_SIZE) {
        const batchSize = Math.min(CHUNK_SIZE, count - i);
        const batch: AIImage[] = [];

        for (let j = 0; j < batchSize; j++) {
            const id = `stress_test_${totalGenerated + j}_${Math.random().toString(36).slice(2, 7)}`;
            const model = models[Math.floor(Math.random() * models.length)];
            const activeTags = tags.filter(() => Math.random() > 0.7);
            const timestamp = Date.now() - Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 365); // Random date in last year

            batch.push({
                id: id,
                url: `stress://${id}`,
                filename: `${id}.png`,
                width: 1024,
                height: 1024,
                timestamp: timestamp,
                fileSize: Math.floor(Math.random() * 5000000),
                thumbnailUrl: '/branding/ambit-window-icon.png',
                isFavorite: Math.random() > 0.9,
                isPinned: Math.random() > 0.95,
                metadata: {
                    positivePrompt: `Generated stress test image ${totalGenerated + j}. A beautiful ${activeTags.join(', ')} scene, high quality, 8k, ${model} style.`,
                    negativePrompt: 'low quality, blurry, distorted',
                    model: model,
                    sampler: samplers[Math.floor(Math.random() * samplers.length)],
                    cfg: 5 + Math.random() * 5,
                    steps: 20 + Math.floor(Math.random() * 30),
                    seed: Math.floor(Math.random() * 1000000000),
                    tool: GeneratorTool.AUTOMATIC1111,
                    loras: []
                }
            });
        }

        await insertImagesBatch(batch);
        totalGenerated += batchSize;
        if (onProgress) onProgress(totalGenerated, count);

        // Yield to prevent UI freeze
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    console.log(`[StressTest] Generated ${totalGenerated} mock images.`);
};
