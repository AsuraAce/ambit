

import { AIImage, GeneratorTool, ModelType, Collection } from './types';

// Helper to generate random dates within last 30 days
const getRandomDate = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime())).getTime();
};

const SAMPLE_PROMPTS = [
  "cyberpunk street samurai, neon rain, high contrast, 8k resolution, unreal engine 5 render",
  "a cozy cottage in the woods, watercolor style, studio ghibli aesthetic, lush greenery, peaceful",
  "portrait of an astronaut on mars, cinematic lighting, detailed helmet reflection, dust storm background",
  "abstract geometric shapes, bauhaus style, primary colors, minimalism, matte finish",
  "dark fantasy knight, intricate armor, glowing runes, fog, ominous atmosphere, oil painting style",
  "steampunk laboratory with brass gears and bubbling potions, cinematic lighting, volumetric fog",
  "isometric view of a solarpunk city, vibrant colors, lush vegetation on skyscrapers, highly detailed",
  "macro photography of a mechanical eye, intricate clockwork details, reflection of a city in the lens"
];

const NEGATIVE_PROMPTS = [
  "blurry, low quality, watermark, text, bad anatomy, deformed hands, extra digits",
  "nsfw, nude, ugly, duplicate, morbid, mutilated, tranny, mutated hands, poorly drawn face"
];

const LORAS = [
  'detail_tweaker_v1.safetensors',
  'add_brightness.safetensors',
  'cinematic_lighting.safetensors',
  'more_details.safetensors',
  'epi_noiseoffset.safetensors'
];

const CONTROL_NETS = [
  'control_v11p_sd15_canny.pth',
  'control_v11f1p_sd15_depth.pth',
  'control_v11p_sd15_openpose.pth'
];

const IP_ADAPTERS = [
  'ip-adapter-plus_sd15.safetensors',
  'ip-adapter-faceid_sd15.bin'
];

export const generateMockImages = (count: number): AIImage[] => {
  const images = Array.from({ length: count }).map((_, i) => {
    const isPortrait = Math.random() > 0.5;
    const width = isPortrait ? 832 : 1216;
    const height = isPortrait ? 1216 : 832;
    const toolValues = Object.values(GeneratorTool);
    const modelValues = Object.values(ModelType);

    const tool = toolValues[Math.floor(Math.random() * toolValues.length)];
    const model = modelValues[Math.floor(Math.random() * modelValues.length)];
    const prompt = SAMPLE_PROMPTS[Math.floor(Math.random() * SAMPLE_PROMPTS.length)];

    // Randomly assign advanced metadata
    const loras = Math.random() > 0.6 ? [LORAS[Math.floor(Math.random() * LORAS.length)]] : undefined;
    const controlNets = Math.random() > 0.8 ? [CONTROL_NETS[Math.floor(Math.random() * CONTROL_NETS.length)]] : undefined;
    const ipAdapters = Math.random() > 0.9 ? [IP_ADAPTERS[Math.floor(Math.random() * IP_ADAPTERS.length)]] : undefined;

    return {
      id: `img_${i}`,
      url: '/branding/ambit-window-icon.png',
      thumbnailUrl: '/branding/ambit-window-icon.png',
      filename: `gen_${Date.now()}_${i}.png`,
      fileSize: Math.floor(Math.random() * 5000000) + 1000000, // Random size between 1MB and 6MB
      timestamp: getRandomDate(),
      width,
      height,
      isFavorite: Math.random() > 0.8,
      metadata: {
        tool,
        model,
        seed: Math.floor(Math.random() * 9999999999),
        steps: Math.floor(Math.random() * 30) + 20,
        cfg: Number((Math.random() * 5 + 3).toFixed(1)),
        sampler: 'DPM++ 2M Karras',
        positivePrompt: prompt,
        negativePrompt: NEGATIVE_PROMPTS[0],
        workflowJson: tool === GeneratorTool.COMFYUI ? '{"nodes": [...]}' : undefined,
        loras,
        controlNets,
        ipAdapters
      }
    };
  });

  // CREATE DUPLICATES
  // Take the first 5 images and create clones with different IDs but same metadata/content
  const duplicates = images.slice(0, 5).map((src, i) => ({
    ...src,
    id: `img_dup_${i}`,
    filename: `copy_of_${src.filename}`,
    timestamp: src.timestamp + 1000, // Created slightly later
  }));

  return [...images, ...duplicates];
};

export const INITIAL_COLLECTIONS: Collection[] = [];
