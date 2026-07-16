import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import {
    Layout, Search, Check, Plus, FileText, ClipboardList, AlertCircle, Save, Code
} from 'lucide-react';
import { AIImage, GeneratorTool, Collection } from '../../../../types';
import { getCollectionsForImage } from '../../../../services/db/collectionRepo';
import { TooltipButton } from '../../../../components/ui/InfoTooltip';

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

type MembershipLoadState = {
    imageId: string;
    status: 'loading' | 'ready' | 'error';
};

const membershipKeySeparator = '\u0000';

const retainRelevantMemberships = (
    memberships: Map<string, string[]>,
    activeImageId: string,
    pendingKeys: Set<string>
): Map<string, string[]> => {
    const retainedImageIds = new Set([activeImageId]);
    pendingKeys.forEach(key => retainedImageIds.add(key.split(membershipKeySeparator, 1)[0]));
    if (memberships.size <= retainedImageIds.size
        && [...memberships.keys()].every(imageId => retainedImageIds.has(imageId))) {
        return memberships;
    }

    const retained = new Map<string, string[]>();
    retainedImageIds.forEach(imageId => {
        const imageMemberships = memberships.get(imageId);
        if (imageMemberships) retained.set(imageId, imageMemberships);
    });
    return retained;
};

const hasPendingMembershipForImage = (pendingKeys: Set<string>, imageId: string): boolean => (
    [...pendingKeys].some(key => key.startsWith(`${imageId}${membershipKeySeparator}`))
);

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
    const [collectionQuery, setCollectionQuery] = useState('');
    const [membershipsByImage, setMembershipsByImage] = useState<Map<string, string[]>>(
        () => new Map([[image.id, []]])
    );
    const [membershipLoadState, setMembershipLoadState] = useState<MembershipLoadState>({
        imageId: image.id,
        status: 'loading'
    });
    const [membershipRetryToken, setMembershipRetryToken] = useState(0);
    const [pendingMembershipKeys, setPendingMembershipKeys] = useState<Set<string>>(() => new Set());
    const pendingMembershipKeysRef = useRef(new Set<string>());
    const activeImageIdRef = useRef(image.id);
    const membershipRequestIdRef = useRef(0);
    const imageCollections = membershipsByImage.get(image.id) ?? [];
    const isMembershipLoading = membershipLoadState.imageId !== image.id
        || membershipLoadState.status === 'loading';
    const hasMembershipError = membershipLoadState.imageId === image.id
        && membershipLoadState.status === 'error';
    const isMembershipReady = membershipLoadState.imageId === image.id
        && membershipLoadState.status === 'ready';

    useLayoutEffect(() => {
        activeImageIdRef.current = image.id;
        setMembershipsByImage(prev => (
            retainRelevantMemberships(prev, image.id, pendingMembershipKeysRef.current)
        ));
    }, [image.id]);

    const [isPromptDirty, setIsPromptDirty] = useState(false);
    const [isNegativePromptDirty, setIsNegativePromptDirty] = useState(false);
    const [isNotesDirty, setIsNotesDirty] = useState(false);
    const [promptSuggestions, setPromptSuggestions] = useState<string[]>([]);
    const [notesSuggestions, setNotesSuggestions] = useState<string[]>([]);

    // Fetch collections for this image on demand
    useEffect(() => {
        let isCancelled = false;
        const imageId = image.id;
        const requestId = membershipRequestIdRef.current + 1;
        membershipRequestIdRef.current = requestId;
        const fetchImageMembership = async () => {
            setMembershipLoadState({ imageId, status: 'loading' });
            try {
                const colIds = await getCollectionsForImage(imageId);
                if (!isCancelled && membershipRequestIdRef.current === requestId) {
                    setMembershipsByImage(prev => {
                        const next = new Map(retainRelevantMemberships(
                            prev,
                            imageId,
                            pendingMembershipKeysRef.current
                        ));
                        next.set(imageId, colIds);
                        return next;
                    });
                    setMembershipLoadState({ imageId, status: 'ready' });
                }
            } catch (e) {
                console.error("Failed to fetch image collections", e);
                if (!isCancelled && membershipRequestIdRef.current === requestId) {
                    setMembershipLoadState({ imageId, status: 'error' });
                }
            }
        };
        fetchImageMembership();
        return () => { isCancelled = true; };
    }, [image.id, membershipRetryToken]);

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
            {/* Collections */}
            <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2"><Layout className="w-4 h-4 text-sage-500" /><h3 className="text-xs font-bold uppercase text-gray-500 tracking-wider">Collections</h3></div>
                </div>
                <div className="relative mb-2">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <input type="text" placeholder="Find collection..." value={collectionQuery} onChange={(e) => setCollectionQuery(e.target.value)} className="w-full bg-white dark:bg-zinc-800/50 border border-gray-200 dark:border-white/10 rounded-lg pl-8 pr-2 py-1.5 text-xs text-gray-900 dark:text-white focus:border-sage-500 outline-none" />
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1 relative">
                    {isMembershipLoading && (
                        <div className="absolute inset-0 bg-white/50 dark:bg-zinc-900/50 flex items-center justify-center z-10 backdrop-blur-[1px]">
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-sage-500 border-t-transparent" />
                        </div>
                    )}
                    {hasMembershipError && (
                        <div role="alert" className="absolute inset-0 bg-white/90 dark:bg-zinc-900/90 flex flex-col items-center justify-center gap-2 z-10 px-4 text-center">
                            <span className="text-xs text-gray-600 dark:text-gray-300">Could not load collection membership.</span>
                            <button
                                type="button"
                                onClick={() => setMembershipRetryToken(token => token + 1)}
                                className="text-xs font-medium text-sage-700 dark:text-sage-300 hover:underline"
                            >
                                Retry
                            </button>
                        </div>
                    )}
                    {collections.filter(c => (
                        !c.filters && c.name.toLowerCase().includes(collectionQuery.toLowerCase())
                    )).map(col => {
                        const isIn = imageCollections.includes(col.id);
                        const membershipKey = `${image.id}${membershipKeySeparator}${col.id}`;
                        const isPending = pendingMembershipKeys.has(membershipKey);
                        return (
                            <button
                                type="button"
                                key={col.id}
                                aria-pressed={isIn}
                                aria-busy={isPending}
                                disabled={!isMembershipReady || isPending}
                                onClick={async () => {
                                    const wasIn = isIn;
                                    const shouldBelong = !wasIn;
                                    const imageId = image.id;
                                    if (pendingMembershipKeysRef.current.has(membershipKey)) return;
                                    pendingMembershipKeysRef.current.add(membershipKey);
                                    setPendingMembershipKeys(prev => {
                                        const next = new Set(prev);
                                        next.add(membershipKey);
                                        return next;
                                    });
                                    setMembershipsByImage(prev => {
                                        const memberships = prev.get(imageId) ?? [];
                                        const next = new Map(retainRelevantMemberships(
                                            prev,
                                            activeImageIdRef.current,
                                            pendingMembershipKeysRef.current
                                        ));
                                        next.set(imageId, shouldBelong
                                            ? (memberships.includes(col.id) ? memberships : [...memberships, col.id])
                                            : memberships.filter(id => id !== col.id));
                                        return next;
                                    });

                                    let didPersist = false;
                                    try {
                                        didPersist = await onSetCollectionMembership(imageId, col.id, shouldBelong);
                                    } catch {
                                        didPersist = false;
                                    }

                                    const settledMembership = didPersist ? shouldBelong : wasIn;
                                    pendingMembershipKeysRef.current.delete(membershipKey);
                                    setMembershipsByImage(prev => {
                                        const memberships = prev.get(imageId) ?? [];
                                        const next = new Map(retainRelevantMemberships(
                                            prev,
                                            activeImageIdRef.current,
                                            pendingMembershipKeysRef.current
                                        ));
                                        if (
                                            activeImageIdRef.current === imageId
                                            || hasPendingMembershipForImage(pendingMembershipKeysRef.current, imageId)
                                        ) {
                                            next.set(imageId, settledMembership
                                                ? (memberships.includes(col.id) ? memberships : [...memberships, col.id])
                                                : memberships.filter(id => id !== col.id));
                                        }
                                        return next;
                                    });

                                    if (activeImageIdRef.current === imageId) {
                                        membershipRequestIdRef.current += 1;
                                        setMembershipLoadState({ imageId, status: 'ready' });
                                    }

                                    setPendingMembershipKeys(prev => {
                                        const next = new Set(prev);
                                        next.delete(membershipKey);
                                        return next;
                                    });
                                }}
                                className={`w-full text-left px-4 py-3 rounded-xl text-sm flex items-center justify-between border transition-all disabled:cursor-wait disabled:opacity-70 ${isIn ? 'bg-sage-100 dark:bg-sage-900/20 border-sage-300 dark:border-sage-500/40 text-sage-700 dark:text-sage-300' : 'bg-white dark:bg-zinc-800/50 border-gray-200 dark:border-white/5 text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5'}`}
                            >
                                <span className="truncate">{col.name}</span>
                                {isIn ? <Check className="w-3.5 h-3.5 text-sage-500" /> : <Plus className="w-3.5 h-3.5" />}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Edit Prompt */}
            <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2"><FileText className="w-3 h-3 text-sage-500" /><h3 className="text-xs font-bold uppercase text-gray-500 tracking-wider">Positive Prompt</h3></div>
                    <div className="flex items-center gap-2">
                        {/* Only show paste button for SD WebUI compatible tools */}
                        {(image.metadata.tool === GeneratorTool.AUTOMATIC1111 ||
                            image.metadata.tool === GeneratorTool.FORGE ||
                            image.metadata.tool === GeneratorTool.UNKNOWN) && (
                                <button
                                    onClick={async () => {
                                        try {
                                            const text = await navigator.clipboard.readText();
                                            if (!text || !text.includes('Steps:')) return;

                                            // Intelligent SD WebUI Parser
                                            const parts = text.split('\n');
                                            let positive = '';
                                            let negative = '';
                                            let state = 0; // 0: positive, 1: negative, 2: params

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
                                                // Trigger save immediately if pasting
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
                                    className="text-[10px] font-medium text-sage-600 dark:text-sage-400 hover:text-sage-700 dark:hover:text-sage-300 flex items-center gap-1.5 transition-all bg-transparent dark:bg-sage-500/5 px-2.5 py-1 rounded-lg border border-sage-500/20 hover:border-sage-500/50 hover:bg-sage-500/10 active:scale-95 shadow-sm"
                                    title="Paste & Parse from Clipboard (Auto1111 format)"
                                >
                                    <ClipboardList className="w-3 h-3" /> Parse from Clipboard
                                </button>
                            )}
                    </div>
                </div>
                <div className="relative">
                    <textarea
                        value={promptValue}
                        onChange={handlePromptChange}
                        onBlur={savePrompt}
                        className={`w-full h-32 p-3 text-sm font-sans border rounded-xl bg-white dark:bg-zinc-800/50 focus:border-sage-500 focus:ring-1 focus:ring-sage-500 outline-none resize-none transition-colors ${isPromptDirty ? 'border-amber-300 dark:border-amber-500/50 bg-amber-50/10' : 'border-gray-200 dark:border-white/10'}`}
                        placeholder="Enter positive prompt..."
                    />
                    {isPromptDirty && <div className="absolute bottom-2 right-2 text-[10px] text-amber-600 font-bold bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Unsaved</div>}

                    {/* Autocomplete Suggestions */}
                    {promptSuggestions.length > 0 && (
                        <div className="absolute left-0 right-0 bottom-full mb-1 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden z-20">
                            {promptSuggestions.map((suggestion, i) => (
                                <button
                                    key={i}
                                    className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-zinc-700 flex items-center justify-between group"
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
                                    <Plus className="w-3 h-3 text-gray-400 group-hover:text-sage-500" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Edit Negative Prompt */}
            <div className="mb-6">
                <div className="flex items-center gap-2 mb-2"><FileText className="w-3 h-3 text-red-400" /><h3 className="text-xs font-bold uppercase text-gray-500 tracking-wider">Negative Prompt</h3></div>
                <div className="relative">
                    <textarea
                        value={negativePromptValue}
                        onChange={(e) => { setNegativePromptValue(e.target.value); setIsNegativePromptDirty(true); }}
                        onBlur={savePrompt}
                        className={`w-full h-24 p-3 text-sm font-sans border rounded-xl bg-white dark:bg-zinc-800/50 focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none resize-none transition-colors ${isNegativePromptDirty ? 'border-amber-300 dark:border-amber-500/50 bg-amber-50/10' : 'border-gray-200 dark:border-white/10'}`}
                        placeholder="Enter negative prompt..."
                    />
                    {isNegativePromptDirty && <div className="absolute bottom-2 right-2 text-[10px] text-amber-600 font-bold bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Unsaved</div>}
                </div>
            </div>

            {/* Notes */}
            <div>
                <div className="flex items-center gap-2 mb-2"><Code className="w-3 h-3 text-gray-400" /><h3 className="text-xs font-bold uppercase text-gray-500 tracking-wider">Notes</h3></div>
                <div className="relative">
                    <textarea
                        value={notes}
                        onChange={(e) => {
                            setNotes(e.target.value);
                            setIsNotesDirty(true);
                            // Simple suggestion logic for notes too?
                            const lastWord = e.target.value.split(/\s+/).pop()?.toLowerCase();
                            if (lastWord && lastWord.startsWith('#') && lastWord.length > 1) {
                                // specialized hash tag logic
                            }
                        }}
                        onBlur={handleNotesBlur}
                        className="w-full h-32 p-3 text-sm font-sans border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-zinc-800/30 focus:bg-white dark:focus:bg-zinc-800/50 focus:border-sage-500 outline-none resize-none transition-all placeholder:text-gray-400"
                        placeholder="Add your notes here..."
                    />
                    {isNotesDirty && (
                        <div className="absolute bottom-3 right-3 flex items-center gap-2">
                            <span className="text-[10px] text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">Unsaved</span>
                            <TooltipButton label="Save Notes" content="Save Notes" onClick={handleNotesBlur} className="p-1.5 bg-sage-500 text-white rounded-lg shadow-lg hover:scale-105 transition-transform"><Save className="w-3.5 h-3.5" /></TooltipButton>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
