import { invoke } from '@tauri-apps/api/core';
import { A1111Config, A1111FolderType } from './types';

export const detectA1111Folders = async (rootPath: string): Promise<A1111Config> => {
    // Standard A1111 subfolders in the 'outputs' directory
    const standardFolders = [
        { type: A1111FolderType.TXT2IMG, subPath: 'outputs/txt2img-images' },
        { type: A1111FolderType.IMG2IMG, subPath: 'outputs/img2img-images' },
        { type: A1111FolderType.TXT2IMG, subPath: 'outputs/txt2img-grids', isGrid: true },
        { type: A1111FolderType.IMG2IMG, subPath: 'outputs/img2img-grids', isGrid: true },
        { type: A1111FolderType.EXTRAS, subPath: 'outputs/extras-images' },
    ];

    const folders: A1111Config['folders'] = [];

    for (const folder of standardFolders) {
        const fullPath = `${rootPath}/${folder.subPath}`;
        try {
            const exists = await invoke('check_path_exists', { path: fullPath });
            if (exists) {
                folders.push({
                    type: folder.isGrid ? A1111FolderType.GRID : folder.type,
                    path: fullPath,
                    isActive: true
                });
            }
        } catch (e) {
            // Path doesn't exist or error, skip
        }
    }

    return {
        rootPath,
        folders
    };
};
