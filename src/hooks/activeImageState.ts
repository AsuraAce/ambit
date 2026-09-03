import type { AIImage } from '../types';

export interface ActiveImageStateAdapter {
    getImage: (imageId: string) => AIImage | undefined;
    updateImage: (imageId: string, updater: (image: AIImage) => AIImage) => void;
    removeImage: (imageId: string) => void;
}
