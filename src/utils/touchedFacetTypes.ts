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

export interface TouchedFacetResources {
    checkpoints: string[];
    loras: string[];
    embeddings: string[];
    hypernetworks: string[];
    controlNets: string[];
    ipAdapters: string[];
    tools: string[];
}

type MetadataLike = Partial<Pick<
    ImageMetadata,
    'tool' | 'model' | 'overrideModel' | 'loras' | 'embeddings' | 'hypernetworks' | 'controlNets' | 'ipAdapters'
>> | null | undefined;

export const createEmptyTouchedFacetResources = (): TouchedFacetResources => ({
    checkpoints: [],
    loras: [],
    embeddings: [],
    hypernetworks: [],
    controlNets: [],
    ipAdapters: [],
    tools: []
});

const cleanResourceName = (value: string): string => {
    let name = value.trim();
    const weightedIndex = name.indexOf(' (');
    const colonIndex = name.indexOf(':');
    const cutIndex = [weightedIndex, colonIndex]
        .filter(index => index > 0)
        .sort((a, b) => a - b)[0];

    if (cutIndex !== undefined) {
        name = name.slice(0, cutIndex).trim();
    }

    return name.replace(/\.(safetensors|ckpt|pt|bin|pth)$/i, '').trim();
};

const normalizeName = (value: string | undefined | null, fallback?: string): string | null => {
    const cleaned = value ? cleanResourceName(value) : '';
    if (cleaned) {
        return cleaned;
    }
    return fallback ?? null;
};

const addUnique = (values: string[], value: string | null) => {
    if (value && !values.includes(value)) {
        values.push(value);
    }
};

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

export const collectTouchedFacetResourcesFromMetadata = (metadata: MetadataLike): TouchedFacetResources => {
    const touched = createEmptyTouchedFacetResources();

    if (!metadata) {
        return touched;
    }

    addUnique(touched.checkpoints, normalizeName(metadata?.overrideModel || metadata?.model, 'Unknown'));
    addUnique(touched.tools, normalizeName(metadata?.tool, 'Unknown'));

    metadata?.loras?.forEach(value => addUnique(touched.loras, normalizeName(value)));
    metadata?.embeddings?.forEach(value => addUnique(touched.embeddings, normalizeName(value)));
    metadata?.hypernetworks?.forEach(value => addUnique(touched.hypernetworks, normalizeName(value)));
    metadata?.controlNets?.forEach(value => addUnique(touched.controlNets, normalizeName(value)));
    metadata?.ipAdapters?.forEach(value => addUnique(touched.ipAdapters, normalizeName(value)));

    return touched;
};

export const mergeTouchedFacetResources = (
    ...resources: TouchedFacetResources[]
): TouchedFacetResources => {
    const merged = createEmptyTouchedFacetResources();

    resources.forEach(resource => {
        resource.checkpoints.forEach(value => addUnique(merged.checkpoints, value));
        resource.loras.forEach(value => addUnique(merged.loras, value));
        resource.embeddings.forEach(value => addUnique(merged.embeddings, value));
        resource.hypernetworks.forEach(value => addUnique(merged.hypernetworks, value));
        resource.controlNets.forEach(value => addUnique(merged.controlNets, value));
        resource.ipAdapters.forEach(value => addUnique(merged.ipAdapters, value));
        resource.tools.forEach(value => addUnique(merged.tools, value));
    });

    return merged;
};

export const hasTouchedFacetResources = (resources: TouchedFacetResources): boolean => {
    return Object.values(resources).some(values => values.length > 0);
};

export const touchedFacetResourcesToTypes = (resources: TouchedFacetResources): FacetType[] => {
    const types = new Set<FacetType>();

    if (resources.checkpoints.length > 0) types.add('checkpoints');
    if (resources.loras.length > 0) types.add('loras');
    if (resources.embeddings.length > 0) types.add('embeddings');
    if (resources.hypernetworks.length > 0) types.add('hypernetworks');
    if (resources.controlNets.length > 0) types.add('controlNets');
    if (resources.ipAdapters.length > 0) types.add('ipAdapters');
    if (resources.tools.length > 0) types.add('tools');

    return orderFacetTypes(types);
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

export const collectTouchedFacetResourcesFromMetadataDiff = (
    previous: MetadataLike,
    next: MetadataLike
): TouchedFacetResources => {
    return mergeTouchedFacetResources(
        collectTouchedFacetResourcesFromMetadata(previous),
        collectTouchedFacetResourcesFromMetadata(next)
    );
};
