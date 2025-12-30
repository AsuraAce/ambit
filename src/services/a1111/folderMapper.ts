import { A1111FolderType } from './types';

export const getGenerationTypeFromPath = (path: string): A1111FolderType => {
    const lowerPath = path.toLowerCase().replace(/\\/g, '/');

    if (lowerPath.includes('-grids') || lowerPath.includes('/grids/')) {
        return A1111FolderType.GRID;
    }
    if (lowerPath.includes('/txt2img-images') || lowerPath.includes('/outputs/txt2img')) {
        return A1111FolderType.TXT2IMG;
    }
    if (lowerPath.includes('/img2img-images') || lowerPath.includes('/outputs/img2img')) {
        return A1111FolderType.IMG2IMG;
    }
    if (lowerPath.includes('/extras-images') || lowerPath.includes('/outputs/extras')) {
        return A1111FolderType.EXTRAS;
    }

    return A1111FolderType.UNKNOWN;
};
