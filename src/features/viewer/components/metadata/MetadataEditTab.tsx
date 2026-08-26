import React, { useState } from 'react';
import {
    Plus, ClipboardList, AlertCircle, Save
} from 'lucide-react';
import { AIImage, GeneratorTool, Collection } from '../../../../types';
import { TooltipButton } from '../../../../components/ui/InfoTooltip';
import { CollectionMembershipPicker } from '../CollectionMembershipPicker';
import { MetadataTextAreaField } from './MetadataTextAreaField';

interface MetadataEditTabProps {
    image: AIImage;
    collections: Collection[];
    availableTags: string[];

    notes: string;
    setNotes: (s: string) => void;
    promptValue: string;
    setPromptValue: (s: string) => void;
    negativePromptValue: string;
    setNegativePromptValue: (s: string) => void;

    onSetCollectionMembership: (imageId: string, colId: string, shouldBelong: boolean) => Promise<boolean>;
    onUpdatePrompt?: (imageId: string, prompt: string) => void;
    onUpdateNegativePrompt?: (imageId: string, negativePrompt: string) => void;
    onUpdateNotes?: (imageId: string, notes: string) => void;
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
    onUpdateNotes
}: MetadataEditTabProps) => {
    // Local State
    const [isPromptDirty, setIsPromptDirty] = useState(false);
    const [isNegativePromptDirty, setIsNegativePromptDirty] = useState(false);
    const [isNotesDirty, setIsNotesDirty] = useState(false);
    const [promptSuggestions, setPromptSuggestions] = useState<string[]>([]);
    const [notesSuggestions, setNotesSuggestions] = useState<string[]>([]);

    const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setPromptValue(e.target.value);
        setIsPromptDirty(true);

        const lastToken = e.target.value.split(',').pop()?.trim().toLowerCase();
        if (lastToken && lastToken.length > 1) {
            const matches = availableTags.filter(t => t.toLowerCase().includes(lastToken) && t.toLowerCase() !== lastToken).slice(0, 5);
            setPromptSuggestions(matches);
        } else {
            setPromptSuggestions([]);
        }
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
            onUpdateNotes && onUpdateNotes(image.id, notes);
            setIsNotesDirty(false);
        }
        setTimeout(() => setNotesSuggestions([]), 200);
    };

    return (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 animate-in fade-in slide-in-from-right-4 duration-300 pb-10">
            <CollectionMembershipPicker
                assetId={image.id}
                collections={collections}
                onSetCollectionMembership={onSetCollectionMembership}
            />

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
                            onClick={async () => {
                                try {
                                    const text = await navigator.clipboard.readText();
                                    if (!text || !text.includes('Steps:')) return;

                                    const parts = text.split('\n');
                                    let positive = '';
                                    let negative = '';
                                    let state = 0;

                                    for (const line of parts) {
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
                                        onUpdatePrompt && onUpdatePrompt(image.id, positive);
                                    }
                                    if (negative) {
                                        setNegativePromptValue(negative);
                                        onUpdateNegativePrompt && onUpdateNegativePrompt(image.id, negative);
                                    }
                                } catch (e) {
                                    console.error("Clipboard paste failed", e);
                                }
                            }}
                            className="flex items-center gap-1.5 rounded-lg border border-sage-500/20 bg-transparent px-2.5 py-1 text-[10px] font-medium text-sage-600 shadow-sm transition-all hover:border-sage-500/50 hover:bg-sage-500/10 hover:text-sage-600 active:scale-95 dark:bg-sage-500/5 dark:text-sage-300 dark:hover:text-sage-300"
                            title="Paste & Parse from Clipboard (Auto1111 format)"
                        >
                            <ClipboardList className="h-3 w-3" /> Parse from Clipboard
                        </button>
                    ) : null}
                status={isPromptDirty ? (
                    <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-ember-100 px-2 py-0.5 text-[10px] font-bold text-ember-600 dark:bg-ember-500/15 dark:text-ember-300">
                        <AlertCircle className="h-3 w-3" /> Unsaved
                    </div>
                ) : null}
                overlay={promptSuggestions.length > 0 ? (
                    <div className="absolute bottom-full left-0 right-0 z-20 mb-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-zinc-800">
                        {promptSuggestions.map((suggestion, i) => (
                            <button
                                key={i}
                                className="group flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-gray-100 dark:hover:bg-zinc-700"
                                onClick={() => {
                                    const parts = promptValue.split(',');
                                    parts.pop();
                                    const newValue = [...parts, suggestion].join(', ') + ', ';
                                    setPromptValue(newValue);
                                    setPromptSuggestions([]);
                                    document.querySelector('textarea')?.focus();
                                }}
                            >
                                <span className="font-mono text-gray-700 dark:text-gray-300">{suggestion}</span>
                                <Plus className="h-3 w-3 text-gray-400 group-hover:text-sage-500" />
                            </button>
                        ))}
                    </div>
                ) : null}
            />

            <MetadataTextAreaField
                kind="negativePrompt"
                value={negativePromptValue}
                onChange={(e) => { setNegativePromptValue(e.target.value); setIsNegativePromptDirty(true); }}
                onBlur={savePrompt}
                isDirty={isNegativePromptDirty}
                className="mb-6"
                status={isNegativePromptDirty ? (
                    <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-ember-100 px-2 py-0.5 text-[10px] font-bold text-ember-600 dark:bg-ember-500/15 dark:text-ember-300">
                        <AlertCircle className="h-3 w-3" /> Unsaved
                    </div>
                ) : null}
            />

            <MetadataTextAreaField
                kind="notes"
                value={notes}
                onChange={(e) => {
                    setNotes(e.target.value);
                    setIsNotesDirty(true);
                    const lastWord = e.target.value.split(/\s+/).pop()?.toLowerCase();
                    if (lastWord && lastWord.startsWith('#') && lastWord.length > 1) {
                        // Reserved for note tag suggestions.
                    }
                }}
                onBlur={handleNotesBlur}
                status={isNotesDirty ? (
                    <div className="absolute bottom-3 right-3 flex items-center gap-2">
                        <span className="rounded-full bg-ember-100 px-2 py-0.5 text-[10px] text-ember-600 dark:bg-ember-500/15 dark:text-ember-300">Unsaved</span>
                        <TooltipButton label="Save Notes" content="Save Notes" onClick={handleNotesBlur} className="rounded-lg bg-sage-500 p-1.5 text-white shadow-lg transition-transform hover:scale-105"><Save className="h-3.5 w-3.5" /></TooltipButton>
                    </div>
                ) : null}
            />
        </div>
    );
};
