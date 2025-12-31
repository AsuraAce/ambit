export enum A1111FolderType {
    TXT2IMG = 'txt2img',
    IMG2IMG = 'img2img',
    EXTRAS = 'extras',
    GRID = 'grid',
    SAVED = 'saved',
    UNKNOWN = 'unknown'
}

export enum WebUIVariant {
    A1111 = 'Automatic1111',
    FORGE = 'Forge',
    SDNEXT = 'SD.Next',
    ANAPNOE = 'Anapnoe',
    UNKNOWN = 'Unknown'
}

export interface A1111Config {
    rootPath: string;
    folders: {
        type: A1111FolderType;
        path: string;
        isActive: boolean;
    }[];
}

export interface DiscoveryCandidate {
    path: string;
    name: string;
    imageCount: number;
    inferredType: A1111FolderType;
    isAlreadyLinked: boolean;
    isPriority: boolean;
    variant?: WebUIVariant;
}
