import * as React from 'react';
import { AppWindow, Check, Pencil } from 'lucide-react';
import { GeneratorTool } from '../../../../types';
import { MetadataField } from './MetadataField';

interface MetadataGeneratorFieldProps {
    value: GeneratorTool;
    source?: string;
    modified?: boolean;
    onSave?: (value: GeneratorTool) => void;
}

export const MetadataGeneratorField: React.FC<MetadataGeneratorFieldProps> = ({
    value,
    source,
    modified,
    onSave,
}) => {
    const [isEditing, setIsEditing] = React.useState(false);
    const [draft, setDraft] = React.useState(value);
    const editorRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        setDraft(value);
        setIsEditing(false);
    }, [value]);

    React.useEffect(() => {
        if (!isEditing) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (!editorRef.current?.contains(event.target as Node)) {
                setDraft(value);
                setIsEditing(false);
            }
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [isEditing, value]);

    const save = () => {
        if (draft !== value) onSave?.(draft);
        setIsEditing(false);
    };

    return (
        <MetadataField label="Generator software" icon={AppWindow} source={source} modified={modified}>
            <div ref={editorRef} className="group relative">
                {onSave && !isEditing ? (
                    <button type="button" aria-label="Edit Generation Tool" onClick={() => setIsEditing(true)} className="absolute right-3 top-1/2 z-10 -translate-y-1/2 text-gray-400 opacity-0 transition-opacity hover:text-gray-700 focus-visible:opacity-100 group-hover:opacity-100 dark:text-zinc-500 dark:hover:text-white">
                        <Pencil className="h-3.5 w-3.5" />
                    </button>
                ) : null}
                {isEditing ? (
                    <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-white/10 dark:bg-black/20">
                        <select aria-label="Generator software" value={draft} onChange={event => setDraft(event.target.value as GeneratorTool)} onKeyDown={event => {
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                setDraft(value);
                                setIsEditing(false);
                            }
                        }} autoFocus className="w-full rounded border border-gray-200 bg-white p-2 text-xs text-gray-900 outline-none focus:border-sage-500 dark:border-white/10 dark:bg-zinc-900 dark:text-white">
                            {Object.values(GeneratorTool).map(tool => <option key={tool} value={tool}>{tool}</option>)}
                        </select>
                        <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => { setDraft(value); setIsEditing(false); }} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-900 dark:text-zinc-500 dark:hover:text-white">Cancel</button>
                            <button type="button" onClick={save} className="flex items-center gap-1 rounded bg-sage-600 px-2 py-1 text-xs text-white hover:bg-sage-500"><Check className="h-3 w-3" /> Save</button>
                        </div>
                    </div>
                ) : (
                    <div className="w-full rounded-lg border border-gray-200 bg-gray-50 p-2.5 pr-9 text-sm font-medium text-gray-700 dark:border-white/10 dark:bg-black dark:text-zinc-200">{value}</div>
                )}
            </div>
        </MetadataField>
    );
};
