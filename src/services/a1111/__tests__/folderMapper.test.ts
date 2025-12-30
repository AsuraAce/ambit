import { describe, it, expect } from 'vitest';
import { getGenerationTypeFromPath } from '../folderMapper';
import { A1111FolderType } from '../types';

describe('A1111 folderMapper', () => {
    it('should detect txt2img from standard paths', () => {
        expect(getGenerationTypeFromPath('C:/stable-diffusion-webui/outputs/txt2img-images/2023-10-27/00001.png')).toBe(A1111FolderType.TXT2IMG);
        expect(getGenerationTypeFromPath('/home/user/sd/outputs/txt2img-images/image.png')).toBe(A1111FolderType.TXT2IMG);
    });

    it('should detect img2img from standard paths', () => {
        expect(getGenerationTypeFromPath('D:\\sd-webui\\outputs\\img2img-images\\00042.png')).toBe(A1111FolderType.IMG2IMG);
    });

    it('should detect extras from standard paths', () => {
        expect(getGenerationTypeFromPath('E:/outputs/extras-images/final_upscale.png')).toBe(A1111FolderType.EXTRAS);
    });

    it('should detect grids', () => {
        expect(getGenerationTypeFromPath('C:/sd/outputs/txt2img-grids/grid-001.png')).toBe(A1111FolderType.GRID);
        expect(getGenerationTypeFromPath('/sd/outputs/img2img-grids/batch.png')).toBe(A1111FolderType.GRID);
    });

    it('should return unknown for non-A1111 paths', () => {
        expect(getGenerationTypeFromPath('C:/Photos/Vacation/beach.jpg')).toBe(A1111FolderType.UNKNOWN);
    });
});
