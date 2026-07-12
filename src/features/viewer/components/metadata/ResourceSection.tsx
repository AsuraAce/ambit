import React from 'react';
import { LucideIcon } from 'lucide-react';

interface ResourceSectionProps {
    title: string;
    items: (string | unknown)[]; // Keeping looser type for compatibility with current data shape
    icon: LucideIcon;
    onSearch: (term: string) => void;
    onClose: () => void;
}

export const ResourceSection = ({ title, items, icon: Icon, onSearch, onClose }: ResourceSectionProps) => {
    if (!items || !Array.isArray(items) || items.length === 0) return null;
    return (
        <div className="mb-4 last:mb-0">
            <div className="flex items-center gap-2 mb-2">
                <Icon className="w-3.5 h-3.5 text-sage-500" />
                <h3 className="text-xs font-bold uppercase text-gray-500 tracking-wider">{title}</h3>
            </div>
            <div className="flex flex-wrap gap-2">
                {items.map((item: unknown, i: number) => {
                    let text = String(item);
                    if (typeof item !== 'string') return <div key={i} className="px-2 py-1.5 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-xs font-mono text-gray-700 dark:text-gray-300 truncate">{text}</div>;

                    // Parse potential weight: "name (0.5)"
                    const weightMatch = text.match(/\s+\((-?\d+(\.\d+)?)\)$/);
                    const weight = weightMatch ? weightMatch[1] : null;

                    let name = text;
                    if (weight) {
                        name = name.replace(/\s+\(-?\d+(\.\d+)?\)$/, '').trim();
                    }
                    name = name.replace(/\.(safetensors|pt|ckpt)$/i, '');

                    return (
                        <button
                            key={i}
                            onClick={() => {
                                // Smart Search Prefixing
                                let prefix = '';
                                if (title === 'LoRAs') prefix = 'lora:';
                                else if (title === 'Embeddings') prefix = 'embedding:';
                                else if (title === 'Hypernetworks') prefix = 'hypernet:';

                                onSearch(`${prefix}${name}`);
                                onClose();
                            }}
                            className="flex items-center bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden max-w-full hover:bg-gray-200 dark:hover:bg-white/10 hover:border-sage-500/30 transition-all group"
                        >
                            <div className="px-2 py-1.5 text-xs font-mono text-gray-700 dark:text-gray-300 truncate group-hover:text-sage-600 dark:group-hover:text-sage-300" title={name}>
                                {name}
                            </div>
                            {weight && (
                                <div className="px-1.5 py-1.5 bg-gray-200 dark:bg-white/10 border-l border-gray-200 dark:border-white/10 text-[10px] font-bold text-gray-500 dark:text-zinc-400 group-hover:bg-sage-100 dark:group-hover:bg-sage-900/30 group-hover:text-sage-600">
                                    {weight}
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
