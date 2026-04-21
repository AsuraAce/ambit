import { FacetType, ImageMetadata } from '../types';

const FACET_TYPE_ORDER: readonly FacetType[] = [
    'checkpoints',
    'loras',
    'embeddings',
    'hypernetworks',
    'controlNets',
    'ipAdapters',
    'tools'
];

type MetadataLike = Partial<Pick<
    ImageMetadata,
    'tool' | 'model' | 'overrideModel' | 'loras' | 'embeddings' | 'hypernetworks' | 'controlNets' | 'ipAdapters'
>> | null | undefined;

const addArrayFacetType = (set: Set<FacetType>, values: string[] | undefined, type: FacetType) => {
    if (Array.isArray(values) && values.length > 0) {
        set.add(type);
    }
};

export const orderFacetTypes = (types: Iterable<FacetType | string>): FacetType[] => {
    const unique = new Set<FacetType>();

    for (const type of types) {
        if (FACET_TYPE_ORDER.includes(type as FacetType)) {
            unique.add(type as FacetType);
        }
    }

    return FACET_TYPE_ORDER.filter(type => unique.has(type));
};

export const collectTouchedFacetTypesFromMetadata = (metadata: MetadataLike): FacetType[] => {
    const touched = new Set<FacetType>();

    // Every imported or updated image can affect checkpoint/tool counts, recency, or dynamic thumbnails.
    touched.add('checkpoints');
    touched.add('tools');

    addArrayFacetType(touched, metadata?.loras, 'loras');
    addArrayFacetType(touched, metadata?.embeddings, 'embeddings');
    addArrayFacetType(touched, metadata?.hypernetworks, 'hypernetworks');
    addArrayFacetType(touched, metadata?.controlNets, 'controlNets');
    addArrayFacetType(touched, metadata?.ipAdapters, 'ipAdapters');

    return orderFacetTypes(touched);
};

export const collectTouchedFacetTypesFromMetadataDiff = (
    previous: MetadataLike,
    next: MetadataLike
): FacetType[] => {
    return orderFacetTypes([
        ...collectTouchedFacetTypesFromMetadata(previous),
        ...collectTouchedFacetTypesFromMetadata(next)
    ]);
};
