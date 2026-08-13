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

    React.useEffect(() => {
        setDraft(value);
        setIsEditing(false);
    }, [value]);

    const save = () => {
        if (draft !== value) onSave?.(draft);
        setIsEditing(false);
    };

    return (
        <MetadataField label="Generator software" icon={AppWindow} source={source} modified={modified}>
            <div className="group relative">
                {onSave && !isEditing ? (
                    <button type="button" aria-label="Edit Generation Tool" onClick={() => setIsEditing(true)} className="absolute right-3 top-1/2 z-10 -translate-y-1/2 text-zinc-500 opacity-0 transition-opacity hover:text-white focus-visible:opacity-100 group-hover:opacity-100">
                        <Pencil className="h-3.5 w-3.5" />
                    </button>
                ) : null}
                {isEditing ? (
                    <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/20 p-2">
                        <select aria-label="Generator software" value={draft} onChange={event => setDraft(event.target.value as GeneratorTool)} autoFocus className="w-full rounded border border-white/10 bg-zinc-900 p-2 text-xs text-white outline-none focus:border-sage-500">
                            {Object.values(GeneratorTool).map(tool => <option key={tool} value={tool}>{tool}</option>)}
                        </select>
                        <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => { setDraft(value); setIsEditing(false); }} className="px-2 py-1 text-xs text-zinc-500 hover:text-white">Cancel</button>
                            <button type="button" onClick={save} className="flex items-center gap-1 rounded bg-sage-600 px-2 py-1 text-xs text-white hover:bg-sage-500"><Check className="h-3 w-3" /> Save</button>
                        </div>
                    </div>
                ) : (
                    <div className="w-full rounded-lg border border-white/10 bg-black p-2.5 pr-9 text-sm font-medium text-zinc-200">{value}</div>
                )}
            </div>
        </MetadataField>
    );
};
