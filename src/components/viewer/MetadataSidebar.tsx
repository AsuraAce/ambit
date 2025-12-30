import * as React from 'react';
import { useState, useEffect } from 'react';
import { Workflow, Wand2, Undo2, Copy, Check, Palette, Tag, Settings2, ClipboardList, Pencil, X, Sparkles, Shuffle, Layout, Search, Plus, FileText, Save, FileJson, Code, Eye, Puzzle, Target, Link, AlertCircle } from 'lucide-react';
import { AIImage, Collection, ModelType, ImageMetadata, GeneratorTool } from '../../types';
import { WorkflowInspector } from './WorkflowInspector';
import { getFilename } from '../../utils/pathUtils';

interface MetadataSidebarProps {
    image: AIImage;
    activeTab: 'info' | 'edit' | 'workflow';
    setActiveTab: (tab: 'info' | 'edit' | 'workflow') => void;
    collections: Collection[];
    availableTags: string[];

    // Data State
    notes: string;
    setNotes: (s: string) => void;
    promptValue: string;
    setPromptValue: React.Dispatch<React.SetStateAction<string>>;
    negativePromptValue: string;
    setNegativePromptValue: React.Dispatch<React.SetStateAction<string>>;

    // Actions
    onUpdateNotes?: (imageId: string, notes: string) => void;
    onUpdatePrompt?: (imageId: string, prompt: string) => void;
    onUpdateNegativePrompt?: (imageId: string, negativePrompt: string) => void;
    onUpdateModel?: (imageId: string, newModel: string) => void;
    onUpdateTool?: (id: string, tool: GeneratorTool) => void;
    onAddToCollection: (imageId: string, colId: string) => void;
    onSearch: (term: string) => void;
    onClose: () => void;
    onRecoverMetadata?: () => void;
    onRevertMetadata?: (id: string) => void;

    // AI Actions
    onAIAnalysis: () => void;
    onGenerateVariations: () => void;
    isAnalyzing: boolean;
    onOpenAIResult?: () => void;

    // Palette
    palette: string[];
    isPaletteLoading: boolean;
}

const ParamItem = ({ label, value, fullWidth = false, isModified = false }: { label: string, value: string, fullWidth?: boolean, isModified?: boolean }) => {
    // Strict Parsing: Hide if value is explicitly "0" or falsy/undefined (except 0 which is handled by string check)
    // Seed 0 is technically valid but often means "random/unknown" in parsed context. 
    // We hide it if it looks like a default value to avoid cluttering UI with hallucinated zeros.
    if (!value || value === '0' || value === 'Unknown') return null;

    return (
        <div className={`relative bg-white dark:bg-zinc-800/50 p-3 rounded-xl ${fullWidth ? 'col-span-2' : ''} border transition-colors group ${isModified ? 'border-amber-500/30 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-900/10' : 'border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10'}`}>
            <div className="flex items-center justify-between mb-1">
                <div className={`text-[10px] uppercase font-bold tracking-wider ${isModified ? 'text-amber-600 dark:text-amber-500' : 'text-gray-400 dark:text-zinc-500'}`}>{label}</div>
                {isModified && <div className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Modified from original" />}
            </div>
            <div className="text-sm text-gray-700 dark:text-gray-300 truncate font-mono" title={value}>{value}</div>
        </div>
    );
};

const ResourceSection = ({ title, items, icon: Icon, onSearch, onClose }: { title: string, items: any[], icon: any, onSearch: (t: string) => void, onClose: () => void }) => {
    if (!items || items.length === 0) return null;
    return (
        <div className="mb-4 last:mb-0">
            <div className="flex items-center gap-2 mb-2">
                <Icon className="w-3.5 h-3.5 text-sage-500" />
                <h3 className="text-xs font-bold uppercase text-gray-500 tracking-wider">{title}</h3>
            </div>
            <div className="flex flex-wrap gap-2">
                {items.map((item: any, i: number) => {
                    let text = String(item);
                    if (typeof item !== 'string') return <div key={i} className="px-2 py-1.5 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-xs font-mono text-gray-700 dark:text-gray-300 truncate">{text}</div>;

                    // Parse potential weight: "name (0.5)"
                    const weightMatch = text.match(/\s+\((-?\d+(\.\d+)?)\)$/);
                    const weight = weightMatch ? weightMatch[1] : null;

                    let name = text.replace(/\.(safetensors|pt|ckpt)$/i, '');
                    if (weight) {
                        name = name.replace(/\s+\(-?\d+(\.\d+)?\)$/, '').trim();
                    }

                    return (
                        <button
                            key={i}
                            onClick={() => {
                                // Smart Search Prefixing
                                const prefix = title === 'LoRAs' ? 'lora:' : '';
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

export const MetadataSidebar: React.FC<MetadataSidebarProps> = ({
    image,
    activeTab,
    setActiveTab,
    collections,
    availableTags,
    notes,
    setNotes,
    promptValue,
    setPromptValue,
    negativePromptValue,
    setNegativePromptValue,
    onUpdateNotes,
    onUpdatePrompt,
    onUpdateNegativePrompt,
    onUpdateModel,
    onUpdateTool,
    onAddToCollection,
    onSearch,
    onClose,
    onRecoverMetadata,
    onRevertMetadata,
    onAIAnalysis,
    onGenerateVariations,
    isAnalyzing,
    onOpenAIResult,
    palette,
    isPaletteLoading
}) => {
    // Local State
    const [isGenDataOpen, setIsGenDataOpen] = useState(() => localStorage.getItem('aigallery_gendata_open') === 'true');
    const [showRaw, setShowRaw] = useState(false);
    const [rawViewMode, setRawViewMode] = useState<'parsed' | 'source' | 'json'>('parsed');
    const [isEditingModel, setIsEditingModel] = useState(false);
    const [editedModel, setEditedModel] = useState('');
    const [isCustomModel, setIsCustomModel] = useState(false);
    const [isEditingTool, setIsEditingTool] = useState(false);
    const [editedTool, setEditedTool] = useState<GeneratorTool>(GeneratorTool.UNKNOWN);
    const [collectionQuery, setCollectionQuery] = useState('');
    const [imageCollections, setImageCollections] = useState<string[]>([]);
    const [isLoadingCollections, setIsLoadingCollections] = useState(false);

    // Fetch collections for this image on demand (replaces old col.imageIds.includes check)
    useEffect(() => {
        let isCancelled = false;
        const fetchImageMembership = async () => {
            setIsLoadingCollections(true);
            try {
                const { getCollectionsForImage } = await import('../../services/db/collectionRepo');
                const colIds = await getCollectionsForImage(image.id);
                if (!isCancelled) setImageCollections(colIds);
            } catch (e) {
                console.error("Failed to fetch image collections", e);
            } finally {
                if (!isCancelled) setIsLoadingCollections(false);
            }
        };
        fetchImageMembership();
        return () => { isCancelled = true; };
    }, [image.id]);

    // Editing State
    const [isPromptDirty, setIsPromptDirty] = useState(false);
    const [isNegativePromptDirty, setIsNegativePromptDirty] = useState(false);
    const [isNotesDirty, setIsNotesDirty] = useState(false);
    const [promptSuggestions, setPromptSuggestions] = useState<string[]>([]);
    const [notesSuggestions, setNotesSuggestions] = useState<string[]>([]);

    // Feedback
    const [copiedPrompt, setCopiedPrompt] = useState(false);
    const [copiedData, setCopiedData] = useState(false);
    const [copiedWorkflow, setCopiedWorkflow] = useState(false);
    const [copiedColor, setCopiedColor] = useState<string | null>(null);

    // --- Comparison Helpers ---
    const isModified = (key: keyof ImageMetadata) => {
        if (!image.originalMetadata) return false;
        return image.metadata[key] !== image.originalMetadata[key];
    };

    const isGenDataModified = () => {
        if (!image.originalMetadata) return false;
        return (
            image.metadata.steps !== image.originalMetadata.steps ||
            image.metadata.cfg !== image.originalMetadata.cfg ||
            image.metadata.seed !== image.originalMetadata.seed ||
            image.metadata.sampler !== image.originalMetadata.sampler ||
            image.metadata.model !== image.originalMetadata.model ||
            image.metadata.overrideModel !== image.originalMetadata.overrideModel ||
            image.metadata.tool !== image.originalMetadata.tool ||
            image.metadata.vae !== image.originalMetadata.vae ||
            image.metadata.clipSkip !== image.originalMetadata.clipSkip ||
            image.metadata.denoisingStrength !== image.originalMetadata.denoisingStrength ||
            image.metadata.hiresUpscale !== image.originalMetadata.hiresUpscale
        );
    };

    // --- Helpers ---
    const toggleGenData = () => {
        setIsGenDataOpen(prev => {
            const newState = !prev;
            localStorage.setItem('aigallery_gendata_open', String(newState));
            return newState;
        });
    };

    const smartTags = (typeof image.metadata.positivePrompt === 'string')
        ? image.metadata.positivePrompt.split(',').map(t => t.trim()).filter(t => t.length > 2 && t.length < 30 && !t.startsWith('score_')).slice(0, 15)
        : [];

    const handleCopyPrompt = () => {
        navigator.clipboard.writeText(image.metadata.positivePrompt);
        setCopiedPrompt(true);
        setTimeout(() => setCopiedPrompt(false), 2000);
    };

    const handleCopyGenData = () => {
        const md = image.metadata;

        // "PROPER" A1111 Merging Logic:
        // If we have rawParameters and have edited the prompts, merge them into the raw string 
        // to preserve complex extension settings (ADetailer, ControlNet extra configs, etc.)
        if (md.rawParameters && md.tool === GeneratorTool.AUTOMATIC1111) {
            if (!isPromptDirty && !isNegativePromptDirty) {
                navigator.clipboard.writeText(md.rawParameters);
            } else {
                const parts = md.rawParameters.split('\n');
                let negativeIdx = -1;
                let stepsIdx = -1;

                for (let i = 0; i < parts.length; i++) {
                    if (parts[i].startsWith('Negative prompt:')) negativeIdx = i;
                    if (parts[i].startsWith('Steps:')) { stepsIdx = i; break; }
                }

                let result = promptValue;
                if (negativePromptValue) {
                    result += `\nNegative prompt: ${negativePromptValue}`;
                }
                if (stepsIdx !== -1) {
                    result += `\n${parts.slice(stepsIdx).join('\n')}`;
                } else {
                    // Fallback to reconstructed params if raw structure is weird
                    const params: string[] = [];
                    params.push(`Steps: ${md.steps || 0}`);
                    params.push(`Sampler: ${md.sampler || 'Euler a'}`);
                    params.push(`CFG scale: ${md.cfg || 7}`);
                    params.push(`Seed: ${md.seed || -1}`);
                    params.push(`Size: ${image.width}x${image.height}`);
                    result += `\n${params.join(', ')}`;
                }
                navigator.clipboard.writeText(result);
            }
            setCopiedData(true);
            setTimeout(() => setCopiedData(false), 2000);
            return;
        }

        const neg = negativePromptValue ? `\nNegative prompt: ${negativePromptValue}` : '';

        const params: string[] = [];
        params.push(`Steps: ${md.steps || 0}`);
        params.push(`Sampler: ${md.sampler || 'Euler a'}`);
        params.push(`CFG scale: ${md.cfg || 7}`);
        params.push(`Seed: ${md.seed || -1}`);
        params.push(`Size: ${image.width}x${image.height}`);

        if (md.modelHash) params.push(`Model hash: ${md.modelHash}`);
        if (md.model && md.model !== 'Unknown') params.push(`Model: ${md.model}`);
        if (md.vae) params.push(`VAE: ${md.vae}`);
        if (md.clipSkip) params.push(`Clip skip: ${md.clipSkip}`);
        if (md.denoisingStrength) params.push(`Denoising strength: ${md.denoisingStrength}`);

        // Hires Fix
        if (md.hiresUpscale) params.push(`Hires upscale: ${md.hiresUpscale}`);
        if (md.hiresSteps) params.push(`Hires steps: ${md.hiresSteps}`);
        if (md.hiresUpscaler) params.push(`Hires upscaler: ${md.hiresUpscaler}`);

        const text = `${md.positivePrompt || ''}${neg}\n${params.join(', ')}`;
        navigator.clipboard.writeText(text);
        setCopiedData(true);
        setTimeout(() => setCopiedData(false), 2000);
    };

    const handleCopyWorkflow = () => {
        if (image.metadata.workflowJson) {
            navigator.clipboard.writeText(image.metadata.workflowJson);
            setCopiedWorkflow(true);
            setTimeout(() => setCopiedWorkflow(false), 2000);
        }
    };

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
        if (onUpdatePrompt) {
            onUpdatePrompt(image.id, promptValue);
            setIsPromptDirty(false);
        }
        if (onUpdateNegativePrompt) {
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

    const renderRawContent = () => {
        if (rawViewMode === 'parsed') {
            return JSON.stringify(image.metadata, null, 2);
        }
        if (rawViewMode === 'json' && image.metadata.workflowJson) {
            try {
                // Try to pretty print the stored JSON string
                const obj = JSON.parse(image.metadata.workflowJson);
                return JSON.stringify(obj, null, 2);
            } catch (e) {
                return image.metadata.workflowJson;
            }
        }
        return image.metadata.rawParameters || "No raw source available.";
    };

    return (
        <div className="w-[420px] flex flex-col h-full bg-white dark:bg-zinc-900/95 backdrop-blur-xl border-l border-gray-200 dark:border-white/10 shadow-2xl">
            {/* Header */}
            <div className="p-6 border-b border-gray-200 dark:border-white/5 shrink-0 bg-gray-50 dark:bg-zinc-900/20">
                <h2 className="text-xl font-bold text-gray-300 dark:text-gray-300 mb-2 leading-tight line-clamp-2 font-sans tracking-tight">
                    {getFilename(image.filename).replace(/\.[^/.]+$/, "")}
                </h2>
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-zinc-400 mt-3">
                    <span className="px-2 py-0.5 rounded bg-gray-200 dark:bg-zinc-800 border border-gray-300 dark:border-white/10 text-sage-700 dark:text-sage-200 font-mono">
                        {image.metadata.tool}
                    </span>

                    {/* Second Pill: Model Name or Hash */}
                    {(image.metadata.overrideModel || image.metadata.model !== 'Unknown' || image.metadata.modelHash) && (
                        <span
                            className="px-2 py-0.5 rounded bg-gray-200 dark:bg-zinc-800 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 font-mono truncate max-w-[200px]"
                            title={image.metadata.overrideModel || image.metadata.model !== 'Unknown' ? (image.metadata.overrideModel || image.metadata.model) : (image.metadata.modelHash || '')}
                        >
                            {image.metadata.overrideModel || image.metadata.model !== 'Unknown'
                                ? (image.metadata.overrideModel || image.metadata.model)
                                : `Hash: ${image.metadata.modelHash?.slice(0, 8)}`}
                        </span>
                    )}

                    <span className="font-mono text-gray-400">•</span>
                    <span>{new Date(image.timestamp).toLocaleDateString()}</span>
                    <span className="font-mono text-gray-400">•</span>
                    <span>{image.width}x{image.height}</span>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 dark:border-white/5 shrink-0 bg-white dark:bg-zinc-900 p-2 gap-2">
                {(['info', 'edit', 'workflow'] as const).map(tab => (
                    (tab !== 'workflow' || image.metadata.workflowJson || image.metadata.tool === 'InvokeAI') && (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            title={tab === 'workflow' && image.metadata.hasWorkflowHint === false ? 'No workflow recorded for this image' : undefined}
                            className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-all rounded-lg flex items-center justify-center gap-2 ${activeTab === tab ? 'text-white bg-sage-600 shadow-lg shadow-sage-500/20' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5'}`}
                        >
                            {tab === 'workflow' && (
                                <Workflow className={`w-3 h-3 ${image.metadata.hasWorkflowHint === false ? 'opacity-10 grayscale brightness-200' : ''}`} />
                            )}
                            {tab}
                        </button>
                    )
                ))}
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col min-h-0 bg-gray-50/50 dark:bg-zinc-900/50 relative">

                {/* INFO TAB */}
                {activeTab === 'info' && (
                    <>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="space-y-6 flex-1">

                                {/* Positive Prompt */}
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-xs font-bold uppercase text-gray-500 tracking-wider">Positive Prompt</h3>
                                            {isModified('positivePrompt') && (
                                                <span className="text-[10px] font-bold text-amber-500 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-500/30">Edited</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {onRecoverMetadata && (
                                                <button onClick={onRecoverMetadata} className="text-amethyst-600 dark:text-amethyst-400 hover:text-amethyst-500 p-1.5 rounded bg-amethyst-100 dark:bg-amethyst-900/20 border border-amethyst-200 dark:border-amethyst-500/20 transition-colors" title="Recover Metadata with AI">
                                                    <Wand2 className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                            {image.originalMetadata && onRevertMetadata && (
                                                <button onClick={() => onRevertMetadata(image.id)} className="text-xs text-orange-600 dark:text-orange-400 hover:text-orange-500 flex items-center gap-1 transition-colors px-2 py-0.5 rounded bg-orange-100 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-500/20" title="Revert to original metadata">
                                                    <Undo2 className="w-3 h-3" />
                                                </button>
                                            )}
                                            <button onClick={handleCopyPrompt} className="text-sage-600 dark:text-sage-400 hover:text-sage-700 dark:hover:text-sage-300 text-xs flex items-center gap-1 transition-colors bg-sage-100 dark:bg-sage-500/10 px-2 py-1 rounded border border-sage-200 dark:border-sage-500/20">
                                                {copiedPrompt ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                                                {copiedPrompt ? "Copied" : "Copy"}
                                            </button>
                                        </div>
                                    </div>
                                    <div className={`p-4 bg-white dark:bg-zinc-950/50 rounded-xl border text-sm font-sans leading-relaxed max-h-48 overflow-y-auto shadow-inner transition-colors ${isModified('positivePrompt') ? 'border-amber-300 dark:border-amber-500/30 text-gray-800 dark:text-gray-200' : 'border-gray-200 dark:border-white/5 text-gray-700 dark:text-gray-300'}`}>
                                        {image.metadata.positivePrompt || <span className="text-gray-500 dark:text-gray-600 italic text-xs">No prompt data found. Use the wand icon to recover with AI.</span>}
                                    </div>
                                </div>

                                {/* Negative Prompt */}
                                {image.metadata.negativePrompt && (
                                    <div>
                                        <h3 className="text-xs font-bold uppercase text-gray-500 tracking-wider mb-2">Negative Prompt</h3>
                                        <div className="p-4 bg-white dark:bg-zinc-950/30 rounded-xl border border-gray-200 dark:border-white/5 text-xs text-red-600/80 dark:text-red-200/60 font-sans leading-relaxed max-h-32 overflow-y-auto">
                                            {image.metadata.negativePrompt}
                                        </div>
                                    </div>
                                )}

                                {/* Palette */}
                                <div>
                                    <div className="flex items-center gap-2 mb-3">
                                        <Palette className="w-3 h-3 text-sage-500" />
                                        <h3 className="text-xs font-bold uppercase text-gray-500 tracking-wider">Color Palette</h3>
                                    </div>
                                    {isPaletteLoading ? (
                                        <div className="flex gap-2 animate-pulse">{[1, 2, 3, 4, 5].map(i => <div key={i} className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-white/5" />)}</div>
                                    ) : palette.length > 0 ? (
                                        <div className="flex gap-2">
                                            {palette.map((color, i) => (
                                                <button key={i} onClick={() => { navigator.clipboard.writeText(color); setCopiedColor(color); setTimeout(() => setCopiedColor(null), 1500); }} className="w-10 h-10 rounded-lg shadow-sm border border-gray-200 dark:border-white/10 hover:scale-110 transition-transform relative group" style={{ backgroundColor: color }}>
                                                    {copiedColor === color && <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-lg"><Check className="w-4 h-4 text-white" /></div>}
                                                </button>
                                            ))}
                                        </div>
                                    ) : <span className="text-xs text-gray-400 italic">No palette extracted</span>}
                                </div>

                                {/* Gen Data */}
                                {/* Always rendered to allow edits, ParamItems will self-hide if empty */}
                                <div className={`border rounded-xl bg-white/50 dark:bg-zinc-800/30 overflow-hidden ${isGenDataModified() ? 'border-amber-300 dark:border-amber-500/30' : 'border-gray-200 dark:border-white/5'}`}>
                                    <button onClick={toggleGenData} className="w-full flex items-center justify-between p-3 bg-gray-50/50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                                        <div className="flex items-center gap-2">
                                            <Settings2 className="w-3.5 h-3.5 text-gray-500" />
                                            <h3 className="text-xs font-bold uppercase text-gray-500 tracking-wider">Generation Data</h3>
                                            {isGenDataModified() && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 ml-1" />}
                                        </div>
                                    </button>

                                    {isGenDataOpen && (
                                        <div className="p-4 space-y-3 animate-in slide-in-from-top-2">
                                            <div className="flex justify-end gap-2">
                                                {image.metadata.workflowJson && (
                                                    <button onClick={handleCopyWorkflow} className="text-[10px] text-sage-600 hover:text-sage-700 dark:text-sage-500 dark:hover:text-sage-400 flex items-center gap-1 transition-colors hover:underline">
                                                        {copiedWorkflow ? <Check className="w-3 h-3 text-sage-500" /> : <FileJson className="w-3 h-3" />} Copy Workflow
                                                    </button>
                                                )}
                                                <button onClick={handleCopyGenData} className="text-[10px] text-gray-400 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 transition-colors hover:underline">
                                                    {copiedData ? <Check className="w-3 h-3 text-green-500" /> : <ClipboardList className="w-3 h-3" />} Copy Params
                                                </button>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">

                                                {/* TOOL ROW - Only in Edit Mode or if Modified, otherwise usually just part of header, but good to have editable here */}
                                                <div className={`bg-white dark:bg-zinc-800/50 p-3 rounded-xl col-span-2 group relative border transition-colors ${isModified('tool') ? 'border-amber-500/30 bg-amber-50/50 dark:bg-amber-900/10' : 'border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10'}`}>
                                                    <div className="flex items-center justify-between mb-1">
                                                        <div className={`text-[10px] uppercase font-bold tracking-wider ${isModified('tool') ? 'text-amber-600 dark:text-amber-500' : 'text-gray-400 dark:text-zinc-500'}`}>Generator Software</div>
                                                        {onUpdateTool && !isEditingTool && (
                                                            <button onClick={() => { setIsEditingTool(true); setEditedTool(image.metadata.tool); }} className="text-gray-400 hover:text-gray-900 dark:hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"><Pencil className="w-3 h-3" /></button>
                                                        )}
                                                    </div>

                                                    {isEditingTool ? (
                                                        <div className="mt-1 flex flex-col gap-2 bg-gray-50 dark:bg-black/20 p-2 rounded-lg border border-gray-200 dark:border-white/10 animate-in fade-in slide-in-from-top-1">
                                                            <select
                                                                value={editedTool}
                                                                onChange={(e) => setEditedTool(e.target.value as GeneratorTool)}
                                                                className="w-full bg-white dark:bg-zinc-900 text-xs text-gray-900 dark:text-white border border-gray-300 dark:border-gray-700 rounded p-1.5 focus:border-sage-500 outline-none"
                                                            >
                                                                {Object.values(GeneratorTool).map(t => <option key={t} value={t}>{t}</option>)}
                                                            </select>
                                                            <div className="flex justify-end gap-2">
                                                                <button onClick={() => setIsEditingTool(false)} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">Cancel</button>
                                                                <button onClick={() => { onUpdateTool && onUpdateTool(image.id, editedTool); setIsEditingTool(false); }} className="px-2 py-1 text-xs bg-sage-600 hover:bg-sage-500 text-white rounded transition-colors flex items-center gap-1">
                                                                    <Check className="w-3 h-3" /> Save
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="text-sm text-gray-700 dark:text-gray-300 truncate font-mono">{image.metadata.tool}</div>
                                                    )}
                                                </div>

                                                {/* Model Row - Always Visible to allow edits even if Unknown */}
                                                <div className={`bg-white dark:bg-zinc-800/50 p-3 rounded-xl col-span-2 group relative border transition-colors ${isModified('model') || isModified('overrideModel') ? 'border-amber-500/30 bg-amber-50/50 dark:bg-amber-900/10' : 'border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10'}`}>
                                                    <div className="flex items-center justify-between mb-1">
                                                        <div className={`text-[10px] uppercase font-bold tracking-wider ${isModified('model') ? 'text-amber-600 dark:text-amber-500' : 'text-gray-400 dark:text-zinc-500'}`}>Model</div>
                                                        {onUpdateModel && !isEditingModel && (
                                                            <button onClick={() => { setIsEditingModel(true); setEditedModel(image.metadata.overrideModel || image.metadata.model); setIsCustomModel(false); }} className="text-gray-400 hover:text-gray-900 dark:hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"><Pencil className="w-3 h-3" /></button>
                                                        )}
                                                    </div>

                                                    {isEditingModel ? (
                                                        <div className="mt-1 flex flex-col gap-2 bg-gray-50 dark:bg-black/20 p-2 rounded-lg border border-gray-200 dark:border-white/10 animate-in fade-in slide-in-from-top-1">
                                                            {!isCustomModel ? (
                                                                <select
                                                                    value={Object.values(ModelType).includes(editedModel as ModelType) ? editedModel : 'custom'}
                                                                    onChange={(e) => {
                                                                        if (e.target.value === 'custom') {
                                                                            setIsCustomModel(true);
                                                                            setEditedModel('');
                                                                        } else {
                                                                            setEditedModel(e.target.value);
                                                                        }
                                                                    }}
                                                                    className="w-full bg-white dark:bg-zinc-900 text-xs text-gray-900 dark:text-white border border-gray-300 dark:border-gray-700 rounded p-1.5 focus:border-sage-500 outline-none"
                                                                >
                                                                    <option value={image.metadata.model} disabled>Current: {image.metadata.model}</option>
                                                                    {Object.values(ModelType).map(m => <option key={m} value={m}>{m}</option>)}
                                                                    <option value="custom">Custom / Other...</option>
                                                                </select>
                                                            ) : (
                                                                <input
                                                                    type="text"
                                                                    value={editedModel}
                                                                    onChange={(e) => setEditedModel(e.target.value)}
                                                                    placeholder="Enter model name..."
                                                                    autoFocus
                                                                    className="w-full bg-white dark:bg-zinc-900 text-xs text-gray-900 dark:text-white border border-gray-300 dark:border-gray-700 rounded p-1.5 focus:border-sage-500 outline-none"
                                                                />
                                                            )}

                                                            <div className="flex justify-end gap-2">
                                                                <button onClick={() => { setIsEditingModel(false); setIsCustomModel(false); }} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">Cancel</button>
                                                                <button onClick={() => { onUpdateModel(image.id, editedModel); setIsEditingModel(false); setIsCustomModel(false); }} className="px-2 py-1 text-xs bg-sage-600 hover:bg-sage-500 text-white rounded transition-colors flex items-center gap-1">
                                                                    <Check className="w-3 h-3" /> Save
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-2">
                                                            <div className="text-sm text-sage-800 dark:text-sage-200 truncate font-medium font-sans">{image.metadata.overrideModel || image.metadata.model}</div>
                                                            {image.metadata.overrideModel && <div className="text-[10px] text-amber-600 dark:text-amber-500 bg-amber-100 dark:bg-amber-900/20 px-1.5 rounded border border-amber-200 dark:border-amber-500/20">Override</div>}
                                                        </div>
                                                    )}
                                                </div>

                                                <ParamItem label="Sampler" value={image.metadata.sampler || 'Unknown'} isModified={isModified('sampler')} />
                                                <ParamItem label="Steps" value={(image.metadata.steps ?? 0).toString()} isModified={isModified('steps')} />
                                                <ParamItem label="CFG Scale" value={(image.metadata.cfg ?? 7).toString()} isModified={isModified('cfg')} />
                                                <ParamItem label="Seed" value={(image.metadata.seed ?? 0).toString()} fullWidth isModified={isModified('seed')} />

                                                {/* Advanced Fields */}
                                                <ParamItem label="VAE" value={image.metadata.vae || ''} isModified={isModified('vae')} />
                                                <ParamItem label="Clip Skip" value={image.metadata.clipSkip?.toString() || ''} isModified={isModified('clipSkip')} />
                                                <ParamItem label="Denoising" value={image.metadata.denoisingStrength?.toString() || ''} isModified={isModified('denoisingStrength')} />

                                                {/* Hires Fix */}
                                                {(image.metadata.hiresUpscale || image.metadata.hiresSteps || image.metadata.hiresUpscaler) && (
                                                    <>
                                                        <div className="col-span-2 h-px bg-gray-200 dark:bg-white/5 my-1" />
                                                        <ParamItem label="Hires Upscale" value={image.metadata.hiresUpscale?.toString() || ''} isModified={isModified('hiresUpscale')} />
                                                        <ParamItem label="Hires Steps" value={image.metadata.hiresSteps?.toString() || ''} isModified={isModified('hiresSteps')} />
                                                        <ParamItem label="Hires Upscaler" value={image.metadata.hiresUpscaler || ''} fullWidth isModified={isModified('hiresUpscaler')} />
                                                    </>
                                                )}

                                                {image.metadata.modelHash && (
                                                    <>
                                                        <div className="col-span-2 h-px bg-gray-200 dark:bg-white/5 my-1" />
                                                        <ParamItem label="Model Hash" value={image.metadata.modelHash} fullWidth />
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Tags */}
                                {smartTags.length > 0 && (
                                    <div>
                                        <div className="flex items-center gap-2 mb-3">
                                            <Tag className="w-3 h-3 text-sage-500" />
                                            <h3 className="text-xs font-bold uppercase text-gray-500 tracking-wider">Smart Tags</h3>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {smartTags.map((tag, i) => (
                                                <button key={i} onClick={() => { onSearch(tag); onClose(); }} className="px-2.5 py-1 text-xs bg-gray-100 dark:bg-zinc-800 hover:bg-sage-100 dark:hover:bg-sage-900/40 border border-gray-200 dark:border-white/5 rounded-lg transition-all truncate max-w-[150px] text-gray-600 dark:text-gray-400">
                                                    {tag}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Resources & Addons (Moved Here) */}
                                {(image.metadata.loras || image.metadata.controlNets || image.metadata.ipAdapters) && (
                                    <div className="bg-white dark:bg-zinc-900/40 border border-gray-200 dark:border-white/5 rounded-xl p-4">
                                        <ResourceSection title="LoRAs" items={image.metadata.loras} icon={Puzzle} onSearch={onSearch} onClose={onClose} />
                                        <ResourceSection title="ControlNet" items={image.metadata.controlNets} icon={Target} onSearch={onSearch} onClose={onClose} />
                                        <ResourceSection title="IP-Adapters" items={image.metadata.ipAdapters} icon={Link} onSearch={onSearch} onClose={onClose} />
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* AI Tools */}
                        <div className="p-4 border-t border-gray-200 dark:border-white/5 bg-white dark:bg-zinc-900 z-10 shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 text-amethyst-500" />
                                    <h3 className="text-xs font-bold uppercase text-amethyst-600 dark:text-amethyst-400 tracking-wider">Creative Assistant</h3>
                                </div>
                                {onOpenAIResult && (
                                    <button onClick={onOpenAIResult} className="text-xs text-amethyst-500 hover:text-amethyst-600 hover:underline flex items-center gap-1">
                                        View last result <Eye className="w-3 h-3" />
                                    </button>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={onAIAnalysis} disabled={isAnalyzing}
                                    className="p-4 bg-white/60 dark:bg-zinc-800/40 rounded-xl border border-gray-200 dark:border-white/5 hover:border-amethyst-300 dark:hover:border-amethyst-500/30 transition-all flex flex-col justify-between h-24 text-left group"
                                >
                                    <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Prompt Analysis</span>
                                    <div className="flex items-center justify-between w-full">
                                        <span className="text-[10px] text-gray-500 dark:text-zinc-400 group-hover:text-amethyst-500">Get insights</span>
                                        <Wand2 className="w-4 h-4 text-amethyst-500" />
                                    </div>
                                </button>

                                <button
                                    onClick={onGenerateVariations} disabled={isAnalyzing}
                                    className="p-4 bg-white/60 dark:bg-zinc-800/40 rounded-xl border border-gray-200 dark:border-white/5 hover:border-amethyst-300 dark:hover:border-amethyst-500/30 transition-all flex flex-col justify-between h-24 text-left group"
                                >
                                    <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Variations</span>
                                    <div className="flex items-center justify-between w-full">
                                        <span className="text-[10px] text-gray-500 dark:text-zinc-400 group-hover:text-amethyst-500">Create twists</span>
                                        <Shuffle className="w-4 h-4 text-amethyst-500" />
                                    </div>
                                </button>
                            </div>
                        </div>
                    </>
                )}

                {/* EDIT TAB */}
                {activeTab === 'edit' && (
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
                                {isLoadingCollections && (
                                    <div className="absolute inset-0 bg-white/50 dark:bg-zinc-900/50 flex items-center justify-center z-10 backdrop-blur-[1px]">
                                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-sage-500 border-t-transparent" />
                                    </div>
                                )}
                                {collections.filter(c => c.name.toLowerCase().includes(collectionQuery.toLowerCase())).map(col => {
                                    const isIn = imageCollections.includes(col.id);
                                    return (
                                        <button
                                            key={col.id}
                                            onClick={async () => {
                                                // Optimistic UI for membership
                                                const wasIn = isIn;
                                                setImageCollections(prev => wasIn ? prev.filter(id => id !== col.id) : [...prev, col.id]);
                                                try {
                                                    await onAddToCollection(image.id, col.id);
                                                } catch (e) {
                                                    // Rollback if needed (though onAddToCollection is usually reliable)
                                                    setImageCollections(prev => wasIn ? [...prev, col.id] : prev.filter(id => id !== col.id));
                                                }
                                            }}
                                            className={`w-full text-left px-4 py-3 rounded-xl text-sm flex items-center justify-between border transition-all ${isIn ? 'bg-sage-100 dark:bg-sage-900/20 border-sage-300 dark:border-sage-500/40 text-sage-700 dark:text-sage-300' : 'bg-white dark:bg-zinc-800/50 border-gray-200 dark:border-white/5 text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5'}`}
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
                                    <button
                                        onClick={async () => {
                                            try {
                                                const text = await navigator.clipboard.readText();
                                                if (!text || !text.includes('Steps:')) return;

                                                // Intelligent A1111 Parser
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
                                                    setIsPromptDirty(true);
                                                }
                                                if (negative) {
                                                    setNegativePromptValue(negative);
                                                    setIsNegativePromptDirty(true);
                                                }
                                            } catch (e) {
                                                console.error("Failed to paste metadata", e);
                                            }
                                        }}
                                        className="text-[10px] px-2 py-1 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded transition-colors flex items-center gap-1 text-gray-500"
                                        title="Paste from A1111 Clipboard"
                                    >
                                        <ClipboardList className="w-3 h-3" /> Recreate from A1111
                                    </button>
                                    {(isPromptDirty || isNegativePromptDirty) && <button onClick={savePrompt} className="text-xs flex items-center gap-1 bg-sage-500 text-white px-2 py-1 rounded shadow-md hover:bg-sage-600"><Save className="w-3 h-3" /> Save</button>}
                                </div>
                            </div>
                            <div className="relative">
                                <textarea value={promptValue} onChange={handlePromptChange} placeholder="Enter positive prompt..." className="w-full bg-white dark:bg-zinc-950/50 border border-gray-200 dark:border-white/10 rounded-xl p-4 text-sm font-sans leading-relaxed text-gray-700 dark:text-gray-300 focus:border-sage-500/50 outline-none resize-none h-40 shadow-inner z-10" />
                                {promptSuggestions.length > 0 && (
                                    <div className="absolute top-full left-0 w-full mt-1 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-xl overflow-hidden z-50">
                                        {promptSuggestions.map((s, idx) => (
                                            <button key={idx} onClick={() => { setPromptValue(prev => prev.replace(/,?[^,]*$/, `, ${s}, `)); setPromptSuggestions([]); }} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-white/5 text-gray-600 dark:text-gray-400 border-b border-gray-100 dark:border-white/5 last:border-0">{s}</button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Edit Negative Prompt */}
                        <div className="mb-6">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <FileText className="w-3 h-3 text-red-400/70" />
                                    <h3 className="text-xs font-bold uppercase text-gray-500 tracking-wider">Negative Prompt</h3>
                                </div>
                            </div>
                            <textarea
                                value={negativePromptValue}
                                onChange={(e) => {
                                    setNegativePromptValue(e.target.value);
                                    setIsNegativePromptDirty(true);
                                }}
                                placeholder="Enter negative prompt..."
                                className="w-full bg-white dark:bg-zinc-950/50 border border-gray-200 dark:border-white/10 rounded-xl p-4 text-sm font-sans leading-relaxed text-gray-700 dark:text-gray-300 focus:border-sage-500/50 outline-none resize-none h-32 shadow-inner"
                            />
                        </div>

                        {/* Metadata Toggle */}
                        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-white/5">
                            <button onClick={() => setShowRaw(!showRaw)} className="flex items-center gap-2 text-gray-500 hover:text-gray-900 dark:hover:text-white text-xs py-2 transition-colors font-medium">
                                <Code className="w-3 h-3" /> {showRaw ? "Hide" : "View"} Internal Metadata
                            </button>

                            {showRaw && (
                                <div className="mt-2 p-3 bg-gray-50 dark:bg-black rounded-xl border border-gray-200 dark:border-white/10">
                                    <div className="flex gap-2 mb-2 pb-2 border-b border-gray-200 dark:border-white/10">
                                        <button
                                            onClick={() => setRawViewMode('parsed')}
                                            className={`text-[10px] px-2 py-1 rounded transition-colors ${rawViewMode === 'parsed' ? 'bg-sage-100 dark:bg-sage-900/30 text-sage-600' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'}`}
                                        >
                                            Parsed
                                        </button>
                                        <button
                                            onClick={() => setRawViewMode('source')}
                                            className={`text-[10px] px-2 py-1 rounded transition-colors ${rawViewMode === 'source' ? 'bg-sage-100 dark:bg-sage-900/30 text-sage-600' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'}`}
                                        >
                                            Text
                                        </button>
                                        {image.metadata.workflowJson && (
                                            <button
                                                onClick={() => setRawViewMode('json')}
                                                className={`text-[10px] px-2 py-1 rounded transition-colors ${rawViewMode === 'json' ? 'bg-sage-100 dark:bg-sage-900/30 text-sage-600' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'}`}
                                            >
                                                JSON
                                            </button>
                                        )}
                                    </div>

                                    <pre className="text-gray-600 dark:text-sage-500 text-[10px] overflow-x-auto whitespace-pre-wrap max-h-60 custom-scrollbar font-mono leading-relaxed">
                                        {renderRawContent()}
                                    </pre>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* WORKFLOW TAB */}
                {activeTab === 'workflow' && <WorkflowInspector image={image} />}

            </div>
        </div>
    );
};