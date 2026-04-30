import { AIImage, Collection } from '../types';

type ThumbnailSource = Pick<Collection, 'customThumbnail' | 'thumbnail' | 'thumbnailSourceKind'> | null | undefined;

const matchesImageIdentity = (value: string | null | undefined, image: AIImage): boolean => {
    if (!value) return false;
    return value === image.id || value === image.url || value === image.thumbnailUrl;
};

export const isCollectionThumbnailImage = (image: AIImage, collection: ThumbnailSource): boolean => {
    if (!collection) return false;

    if (collection.customThumbnail) {
        return matchesImageIdentity(collection.customThumbnail, image);
    }

    if (collection.thumbnailSourceKind === 'customImage') {
        return false;
    }

    return matchesImageIdentity(collection.thumbnail, image);
};
