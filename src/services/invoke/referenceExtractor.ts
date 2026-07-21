import type { InvokeImageReferenceInput, InvokeImageReferenceRole } from '../../bindings';

type MetadataRecord = Record<string, unknown>;

export type InvokeImageReferenceExtraction =
    | { status: 'valid'; references: InvokeImageReferenceInput[] }
    | { status: 'invalid'; references: [] };

const isRecord = (value: unknown): value is MetadataRecord =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const parseJsonValue = (value: unknown): { valid: boolean; value: unknown } => {
    if (typeof value !== 'string') return { valid: true, value };

    try {
        return { valid: true, value: JSON.parse(value) as unknown };
    } catch {
        return { valid: false, value: undefined };
    }
};

type ImageNameRead =
    | { status: 'empty' }
    | { status: 'valid'; imageName: string }
    | { status: 'invalid' };

const readImageName = (value: unknown): ImageNameRead => {
    if (value === null || value === undefined) return { status: 'empty' };
    if (typeof value === 'string') {
        return value.trim().length > 0
            ? { status: 'valid', imageName: value }
            : { status: 'empty' };
    }
    if (!isRecord(value) || !('image_name' in value)) return { status: 'invalid' };

    const imageName = value.image_name;
    if (imageName === null || imageName === undefined) return { status: 'empty' };
    if (typeof imageName !== 'string') return { status: 'invalid' };
    return imageName.trim().length > 0
        ? { status: 'valid', imageName }
        : { status: 'empty' };
};

export const extractInvokeImageReferences = (
    rawMetadata: unknown
): InvokeImageReferenceExtraction => {
    if (rawMetadata === null || rawMetadata === undefined) {
        return { status: 'valid', references: [] };
    }

    const parsed = parseJsonValue(rawMetadata);
    if (!parsed.valid || !isRecord(parsed.value)) {
        return { status: 'invalid', references: [] };
    }

    let root: unknown = parsed.value;
    const wrapperRecord = parsed.value;
    for (const key of ['invokeai_metadata', 'sd-metadata', 'dream_metadata']) {
        if (wrapperRecord[key] === undefined) continue;
        const unwrapped = parseJsonValue(wrapperRecord[key]);
        if (!unwrapped.valid || !isRecord(unwrapped.value)) {
            return { status: 'invalid', references: [] };
        }
        root = unwrapped.value;
        break;
    }

    if (!isRecord(root)) return { status: 'invalid', references: [] };

    const payload = isRecord(root.image)
        ? root.image
        : (isRecord(root.generation) ? root.generation : root);
    const roots = payload === root ? [root] : [payload, root];
    const references: InvokeImageReferenceInput[] = [];
    const seen = new Set<string>();
    let hasInvalidReference = false;

    const addReference = (role: InvokeImageReferenceRole, value: unknown) => {
        const imageName = readImageName(value);
        if (imageName.status === 'invalid') {
            hasInvalidReference = true;
            return;
        }
        if (imageName.status === 'empty') return;
        const targetInvokeImageName = imageName.imageName;

        const key = `${role}\u0000${targetInvokeImageName}`;
        if (seen.has(key)) return;
        seen.add(key);
        references.push({ role, targetInvokeImageName });
    };

    const readAdapters = (
        record: MetadataRecord,
        keys: readonly string[],
        imageRole: InvokeImageReferenceRole,
        processedImageRole?: InvokeImageReferenceRole
    ) => {
        keys.forEach((key) => {
            const value = record[key];
            if (value === null || value === undefined || typeof value === 'string') return;
            const items = Array.isArray(value) ? value : [value];
            items.forEach((item) => {
                if (item === null || item === undefined || typeof item === 'string') return;
                if (!isRecord(item)) {
                    hasInvalidReference = true;
                    return;
                }
                addReference(imageRole, item.image);
                if (processedImageRole) {
                    addReference(processedImageRole, item.processed_image);
                    addReference(processedImageRole, item.processedImage);
                }
            });
        });
    };

    roots.forEach((record) => {
        addReference('init_image', record.init_image);
        readAdapters(
            record,
            ['controlnets', 'control_nets', 'control_adapters'],
            'controlnet_image',
            'controlnet_processed_image'
        );
        readAdapters(
            record,
            ['ipAdapters', 'ip_adapters', 'ip_adapter'],
            'ip_adapter_image'
        );
        readAdapters(
            record,
            ['t2iAdapters', 't2i_adapters', 't2i_adapter'],
            't2i_adapter_image',
            't2i_adapter_processed_image'
        );
    });

    if (hasInvalidReference) return { status: 'invalid', references: [] };
    return { status: 'valid', references };
};
