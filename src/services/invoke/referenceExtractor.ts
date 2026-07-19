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

const readImageName = (value: unknown): string | undefined => {
    if (typeof value === 'string') {
        return value.trim().length > 0 ? value : undefined;
    }
    if (!isRecord(value)) return undefined;

    const imageName = value.image_name;
    return typeof imageName === 'string' && imageName.trim().length > 0
        ? imageName
        : undefined;
};

const asItems = (value: unknown): unknown[] => Array.isArray(value) ? value : [value];

export const extractInvokeImageReferences = (
    rawMetadata: unknown
): InvokeImageReferenceExtraction => {
    if (rawMetadata === null || rawMetadata === undefined || rawMetadata === '') {
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

    const addReference = (role: InvokeImageReferenceRole, value: unknown) => {
        const targetInvokeImageName = readImageName(value);
        if (!targetInvokeImageName) return;

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
            if (record[key] === undefined) return;
            asItems(record[key]).forEach((item) => {
                if (!isRecord(item)) return;
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

    return { status: 'valid', references };
};
