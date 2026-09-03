import React, { useState } from 'react';
import { AlertCircle, ClipboardList, ImageIcon, Plus, Save } from 'lucide-react';
import { getDetectedSourceKind, type AIImage, type Collection, GeneratorTool, type SourceKind } from '../../../../types';
import { TooltipButton } from '../../../../components/ui/InfoTooltip';
import { CollectionMembershipPicker } from '../CollectionMembershipPicker';
import { MetadataTextAreaField } from './MetadataTextAreaField';

interface MetadataEditTabProps {
    image: AIImage;
    collections: Collection[];
    availableTags: string[];
    notes: string;
    setNotes: (value: string) => void;
    promptValue: string;
    setPromptValue: (value: string) => void;
    negativePromptValue: string;
    setNegativePromptValue: (value: string) => void;
    onSetCollectionMembership: (imageId: string, collectionId: string, shouldBelong: boolean) => Promise<boolean>;
    onUpdatePrompt?: (imageId: string, prompt: string) => void;
    onUpdateNegativePrompt?: (imageId: string, negativePrompt: string) => void;
    onUpdateNotes?: (imageId: string, notes: string) => void;
    onSetImageKind?: (imageId: string, sourceKindOverride: SourceKind | null) => void | Promise<void>;
    showGenerationFields?: boolean;
}

export const MetadataEditTab = ({
    image,
    collections,
    availableTags,
    notes,
    setNotes,
    promptValue,
    setPromptValue,
    negativePromptValue,
    setNegativePromptValue,
    onSetCollectionMembership,
    onUpdatePrompt,
    onUpdateNegativePrompt,
    onUpdateNotes,
    onSetImageKind,
    showGenerationFields = true,
}: MetadataEditTabProps) => {
    const [isPromptDirty, setIsPromptDirty] = useState(false);
    const [isNegativePromptDirty, setIsNegativePromptDirty] = useState(false);
    const [isNotesDirty, setIsNotesDirty] = useState(false);
    const [promptSuggestions, setPromptSuggestions] = useState<string[]>([]);
    const [isKindSaving, setIsKindSaving] = useState(false);
    const detectedSourceKind = getDetectedSourceKind(image);

    const handlePromptChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const nextValue = event.target.value;
        setPromptValue(nextValue);
        setIsPromptDirty(true);
        const lastToken = nextValue.split(',').pop()?.trim().toLowerCase();
        setPromptSuggestions(lastToken && lastToken.length > 1
            ? availableTags.filter(tag => tag.toLowerCase().includes(lastToken) && tag.toLowerCase() !== lastToken).slice(0, 5)
            : []);
    };

    const savePrompt = () => {
        if (onUpdatePrompt && isPromptDirty) {
            onUpdatePrompt(image.id, promptValue);
            setIsPromptDirty(false);
        }
        if (onUpdateNegativePrompt && isNegativePromptDirty) {
            onUpdateNegativePrompt(image.id, negativePromptValue);
            setIsNegativePromptDirty(false);
        }
    };

    const handleNotesBlur = () => {
        if (isNotesDirty) {
            onUpdateNotes?.(image.id, notes);
            setIsNotesDirty(false);
        }
    };

    const parseClipboard = async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (!text || !text.includes('Steps:')) return;
            let positive = '';
            let negative = '';
            let state = 0;
            for (const line of text.split('\n')) {
                const clean = line.trim();
                if (!clean) continue;
                if (clean.startsWith('Negative prompt:')) {
                    state = 1;
                    negative = clean.replace('Negative prompt:', '').trim();
                    continue;
                }
                if (clean.startsWith('Steps:')) {
                    state = 2;
                    continue;
                }
                if (state === 0) positive += (positive ? '\n' : '') + clean;
                else if (state === 1) negative += (negative ? '\n' : '') + clean;
            }
            if (positive) {
                setPromptValue(positive);
                onUpdatePrompt?.(image.id, positive);
            }
            if (negative) {
                setNegativePromptValue(negative);
                onUpdateNegativePrompt?.(image.id, negative);
            }
        } catch (error) {
            console.error('Clipboard paste failed', error);
        }
    };

    return (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 animate-in fade-in slide-in-from-right-4 duration-300 pb-10">
            {onSetImageKind ? <fieldset className="mb-6" disabled={isKindSaving}>
                <legend className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500">
                    <ImageIcon className="h-4 w-4 text-sage-500" /> Image kind
                </legend>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Image kind">
                    {([
                        { value: null, label: `Automatic (${detectedSourceKind === 'photograph' ? 'Photo' : detectedSourceKind === 'generated' ? 'Generated' : 'Other'})` },
                        { value: 'generated' as const, label: 'Generated' },
                        { value: 'photograph' as const, label: 'Photo' },
                        { value: 'other' as const, label: 'Other' },
                    ]).map(option => {
                        const checked = option.value === null
                            ? image.sourceKindOverride === undefined
                            : image.sourceKindOverride === option.value;
                        return <button
                            key={option.value ?? 'automatic'}
                            type="button"
                            role="radio"
                            aria-checked={checked}
                            disabled={isKindSaving}
                            onClick={() => {
                                if (!onSetImageKind) return;
                                setIsKindSaving(true);
                                void Promise.resolve(onSetImageKind(image.id, option.value)).finally(() => setIsKindSaving(false));
                            }}
                            className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50 disabled:opacity-60 ${checked ? 'border-sage-400 bg-sage-50 text-sage-800 dark:border-sage-500/60 dark:bg-sage-900/20 dark:text-sage-200' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-zinc-800/50 dark:text-gray-300 dark:hover:bg-white/5'}`}
                        >{option.label}</button>;
                    })}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-gray-400">Automatic follows metadata detection. A manual choice is preserved when the image is rescanned.</p>
            </fieldset> : null}

            <CollectionMembershipPicker
                assetId={image.id}
                collections={collections}
                onSetCollectionMembership={onSetCollectionMembership}
            />

            {showGenerationFields ? <>
                <MetadataTextAreaField
                    kind="positivePrompt"
                    value={promptValue}
                    onChange={handlePromptChange}
                    onBlur={savePrompt}
                    isDirty={isPromptDirty}
                    className="mb-6"
                    headerAction={(image.metadata.tool === GeneratorTool.AUTOMATIC1111
                        || image.metadata.tool === GeneratorTool.FORGE
                        || image.metadata.tool === GeneratorTool.UNKNOWN) ? (
                            <button
                                type="button"
                                onClick={() => { void parseClipboard(); }}
                                className="flex items-center gap-1.5 rounded-lg border border-sage-500/20 bg-transparent px-2.5 py-1 text-[10px] font-medium text-sage-600 shadow-sm transition-all hover:border-sage-500/50 hover:bg-sage-500/10 hover:text-sage-600 active:scale-95 dark:bg-sage-500/5 dark:text-sage-300 dark:hover:text-sage-300"
                                title="Paste & Parse from Clipboard (Auto1111 format)"
                            ><ClipboardList className="h-3 w-3" /> Parse from Clipboard</button>
                        ) : null}
                    status={isPromptDirty ? <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-ember-100 px-2 py-0.5 text-[10px] font-bold text-ember-600 dark:bg-ember-500/15 dark:text-ember-300"><AlertCircle className="h-3 w-3" /> Unsaved</div> : null}
                    overlay={promptSuggestions.length > 0 ? <div className="absolute bottom-full left-0 right-0 z-20 mb-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-zinc-800">
                        {promptSuggestions.map(suggestion => <button
                            key={suggestion}
                            type="button"
                            className="group flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-gray-100 dark:hover:bg-zinc-700"
                            onClick={() => {
                                const parts = promptValue.split(',');
                                parts.pop();
                                setPromptValue([...parts, suggestion].join(', ') + ', ');
                                setPromptSuggestions([]);
                                document.querySelector('textarea')?.focus();
                            }}
                        ><span className="font-mono text-gray-700 dark:text-gray-300">{suggestion}</span><Plus className="h-3 w-3 text-gray-400 group-hover:text-sage-500" /></button>)}
                    </div> : null}
                />

                <MetadataTextAreaField
                    kind="negativePrompt"
                    value={negativePromptValue}
                    onChange={event => { setNegativePromptValue(event.target.value); setIsNegativePromptDirty(true); }}
                    onBlur={savePrompt}
                    isDirty={isNegativePromptDirty}
                    className="mb-6"
                    status={isNegativePromptDirty ? <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-ember-100 px-2 py-0.5 text-[10px] font-bold text-ember-600 dark:bg-ember-500/15 dark:text-ember-300"><AlertCircle className="h-3 w-3" /> Unsaved</div> : null}
                />
            </> : null}

            <MetadataTextAreaField
                kind="notes"
                value={notes}
                onChange={event => { setNotes(event.target.value); setIsNotesDirty(true); }}
                onBlur={handleNotesBlur}
                status={isNotesDirty ? <div className="absolute bottom-3 right-3 flex items-center gap-2"><span className="rounded-full bg-ember-100 px-2 py-0.5 text-[10px] text-ember-600 dark:bg-ember-500/15 dark:text-ember-300">Unsaved</span><TooltipButton label="Save Notes" content="Save Notes" onClick={handleNotesBlur} className="rounded-lg bg-sage-500 p-1.5 text-white shadow-lg transition-transform hover:scale-105"><Save className="h-3.5 w-3.5" /></TooltipButton></div> : null}
            />
        </div>
    );
};
