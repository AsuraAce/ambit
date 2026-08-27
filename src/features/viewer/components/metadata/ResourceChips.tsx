import * as React from 'react';
import { MetadataChip } from './MetadataChip';

interface ResourceChipsProps {
    items: readonly unknown[];
    onSelect?: (name: string) => void;
}

export type ResourceFilterKind = 'lora' | 'embedding' | 'hypernet' | 'controlnet' | 'ipadapter';

const RESOURCE_FILTER_PREFIX: Record<ResourceFilterKind, string> = {
    lora: 'lora:',
    embedding: 'embedding:',
    hypernet: 'hypernet:',
    controlnet: 'cn:',
    ipadapter: 'ip:',
};

const WEIGHT_SUFFIX = /\s+\((-?\d+(?:\.\d+)?)\)$/;
const RESOURCE_EXTENSION = /\.(safetensors|pt|ckpt)$/i;

export const parseResourceLabel = (item: string): { name: string; weight: string | null } => {
    const weight = item.match(WEIGHT_SUFFIX)?.[1] ?? null;
    const withoutWeight = weight ? item.replace(WEIGHT_SUFFIX, '').trim() : item;
    return {
        name: withoutWeight.replace(RESOURCE_EXTENSION, ''),
        weight,
    };
};

export const buildResourceSearchTerm = (kind: ResourceFilterKind, name: string): string =>
    `${RESOURCE_FILTER_PREFIX[kind]}${name}`;

export const ResourceChips: React.FC<ResourceChipsProps> = ({ items, onSelect }) => (
    <div className="flex flex-wrap gap-2">
        {items.map((item, index) => {
            if (typeof item !== 'string') {
                return <MetadataChip key={index}><span className="truncate px-2 py-1.5 font-mono text-xs text-gray-700 dark:text-gray-300">{String(item)}</span></MetadataChip>;
            }

            const { name, weight } = parseResourceLabel(item);
            const content = (
                <>
                    <span className="truncate px-2 py-1.5 font-mono text-xs text-gray-700 group-hover:text-sage-600 dark:text-gray-300 dark:group-hover:text-sage-300" title={name}>{name}</span>
                    {weight && <span className="border-l border-gray-200 bg-gray-200 px-1.5 py-1.5 text-[10px] font-bold text-gray-500 group-hover:bg-sage-100 group-hover:text-sage-600 dark:border-white/10 dark:bg-white/10 dark:text-zinc-400 dark:group-hover:bg-sage-900/30">{weight}</span>}
                </>
            );
            return <MetadataChip key={index} onClick={onSelect ? () => onSelect(name) : undefined}>{content}</MetadataChip>;
        })}
    </div>
);
