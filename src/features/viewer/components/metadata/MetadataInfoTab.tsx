import React, { useState } from 'react';
import {
    Wand2, Undo2, Copy, Check, Palette, Settings2, FileJson, ClipboardList,
    Pencil, Sparkles, Eye, Shuffle, Tag, Puzzle, Code, Target, Link
} from 'lucide-react';
import { AIImage, GeneratorTool, ModelType } from '../../../../types';
import { formatModelName } from '../../../../utils/formatUtils';
import { ParamItem } from './ParamItem';
import { ResourceSection } from './ResourceSection';
import { MetadataRawInspector } from './MetadataRawInspector';
import { HighlightedPromptText } from './HighlightedPromptText';
import type { PromptHighlightSpec } from '../../utils/searchHighlights';

interface MetadataInfoTabProps {
    image: AIImage;
    promptValue: string;
    setPromptValue: (s: string) => void;
    negativePromptValue: string;
    palette: string[];
    isPaletteLoading: boolean;
    onSearch: (term: string) => void;
    onClose: () => void;
    onRecoverMetadata?: () => void;
    onRevertMetadata?: (id: string) => void;
    onUpdateModel?: (id: string, model: string) => void;
    onUpdateTool?: (id: string, tool: GeneratorTool) => void;
    onAIAnalysis: () => void;
    onGenerateVariations: () => void;
    isAnalyzing: boolean;
    onOpenAIResult?: () => void;
    isLoading?: boolean;
    searchHighlights?: PromptHighlightSpec;
}

export const MetadataInfoTab = ({
    image,
    promptValue,
    setPromptValue,
    negativePromptValue,
    palette,
    isPaletteLoading,
    onSearch,
    onClose,
    onRecoverMetadata,
    onRevertMetadata,
    onUpdateModel,
    onUpdateTool,
    onAIAnalysis,
    onGenerateVariations,
    isAnalyzing,
    onOpenAIResult,
    isLoading,
    searchHighlights
}: MetadataInfoTabProps) => {
    // Local UI State
    const [isGenDataOpen, setIsGenDataOpen] = useState(() => localStorage.getItem('aigallery_gendata_open') === 'true');
    const [isEditingModel, setIsEditingModel] = useState(false);
    const [editedModel, setEditedModel] = useState('');
    const [isCustomModel, setIsCustomModel] = useState(false);
    const [isEditingTool, setIsEditingTool] = useState(false);
    const [editedTool, setEditedTool] = useState<GeneratorTool>(GeneratorTool.UNKNOWN);

    // Feedback State
    const [copiedPrompt, setCopiedPrompt] = useState(false);
    const [copiedData, setCopiedData] = useState(false);
    const [copiedWorkflow, setCopiedWorkflow] = useState(false);
    const [copiedColor, setCopiedColor] = useState<string | null>(null);

    // --- Helpers ---
    const toggleGenData = () => {
        setIsGenDataOpen(prev => {
            const newState = !prev;
            localStorage.setItem('aigallery_gendata_open', String(newState));
            return newState;
        });
    };

    const isModified = (key: keyof typeof image.metadata) => {
        if (!image.originalMetadata || isLoading) return false;
        const cur = image.metadata[key];
        const orig = image.originalMetadata[key];

        if (cur === orig) return false;

        // Handle equivalent empty values (null, undefined, empty string)
        // CRITICAL: We also treat "Unknown" as empty to avoid modification flags for unresolved models
        const isEmpty = (v: any) => v === null || v === undefined || v === '' || (typeof v === 'string' && v.toLowerCase() === 'unknown');

        if (isEmpty(cur) && isEmpty(orig)) return false;

        // Numerical comparison with epsilon to avoid float jitter (e.g. 7.0 vs 7)
        if (typeof cur === 'number' || typeof orig === 'number') {
            const nCur = Number(cur);
            const nOrig = Number(orig);
            if (!isNaN(nCur) && !isNaN(nOrig)) {
                if (Math.abs(nCur - nOrig) < 0.0001) {
                    return false;
                }
            }
        }

        // Handle string comparison (trimmed)
        if (typeof cur === 'string' && typeof orig === 'string') {
            if (cur.trim() === orig.trim()) return false;
        }

        console.log(`[DEBUG] isModified(${key}): true`, {
            cur,
            orig,
            curType: typeof cur,
            origType: typeof orig,
            filename: image.filename
        });

        // Final fallback: standard comparison (already checked cur === orig above)
        return true;
    };

    const isGenDataModified = () => {
        if (!image.originalMetadata) return false;
        // Technical parameters only (excludes prompts)
        const keys = [
            'steps', 'cfg', 'seed', 'sampler', 'model', 'overrideModel', 'tool',
            'vae', 'clipSkip', 'denoisingStrength', 'hiresUpscale', 'hiresSteps', 'hiresUpscaler'
        ] as const;
        return keys.some(k => isModified(k));
    };

    const hasModifications = () => {
        if (!image.originalMetadata || isLoading) return false;
        return (
            isModified('positivePrompt') ||
            isModified('negativePrompt') ||
            isGenDataModified()
        );
    };

    const smartTags = (typeof image.metadata.positivePrompt === 'string')
        ? image.metadata.positivePrompt.split(',').map(t => t.trim()).filter(t => t.length > 2 && t.length < 30 && !t.startsWith('score_')).slice(0, 15)
        : [];

    const handleCopyPrompt = () => {
        navigator.clipboard.writeText(promptValue);
        setCopiedPrompt(true);
        setTimeout(() => setCopiedPrompt(false), 2000);
    };

    const handleCopyWorkflow = () => {
        if (image.metadata.workflowJson) {
            navigator.clipboard.writeText(image.metadata.workflowJson);
            setCopiedWorkflow(true);
            setTimeout(() => setCopiedWorkflow(false), 2000);
        }
    };

    const handleCopyGenData = () => {
        const md = image.metadata;

        let text = '';
        if (md.rawParameters && md.tool === GeneratorTool.AUTOMATIC1111) {
            text = md.rawParameters;
        } else {
            const params: string[] = [];
            params.push(`Steps: ${md.steps || 0}`);
            params.push(`Sampler: ${md.sampler || 'Euler a'}`);
            if (md.cfg) params.push(`CFG scale: ${md.cfg}`);
            params.push(`Seed: ${md.seed || -1}`);
            params.push(`Size: ${image.width}x${image.height}`);
            if (md.modelHash) params.push(`Model hash: ${md.modelHash}`);
            if (md.model && md.model !== 'Unknown') params.push(`Model: ${md.model}`);

            const neg = negativePromptValue ? `\nNegative prompt: ${negativePromptValue}` : '';
            text = `${md.positivePrompt || ''}${neg}\n${params.join(', ')}`;
        }

        navigator.clipboard.writeText(text);
        setCopiedData(true);
        setTimeout(() => setCopiedData(false), 2000);
    };

    return (
        <>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="space-y-6 flex-1">

                    {/* Positive Prompt */}
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center gap-2">
                                <h3 className="text-xs font-bold uppercase text-gray-500 tracking-wider">Positive Prompt</h3>
                                {/* Toggle: Original / current saved prompt */}
                                {image.originalMetadata && !isLoading && image.originalMetadata.positivePrompt !== image.metadata.positivePrompt && (
                                    <div className="flex gap-1 p-0.5 bg-gray-100 dark:bg-zinc-800/50 rounded-lg border border-gray-200 dark:border-white/10">
                                        <button
                                            onClick={() => setPromptValue(image.metadata.positivePrompt || '')}
                                            className={`px-2 py-0.5 text-[10px] font-bold rounded transition-all ${promptValue === image.metadata.positivePrompt ? 'bg-amethyst-500 text-white shadow' : 'text-gray-500 hover:text-amethyst-500'}`}
                                            title="Show the current saved prompt"
                                        >
                                            Current
                                        </button>
                                        <button
                                            onClick={() => setPromptValue(image.originalMetadata?.positivePrompt || '')}
                                            className={`px-2 py-0.5 text-[10px] font-bold rounded transition-all ${promptValue === image.originalMetadata?.positivePrompt ? 'bg-sage-500 text-white shadow' : 'text-gray-500 hover:text-sage-500'}`}
                                            title="Show the original imported prompt"
                                        >
                                            Original
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                {onRecoverMetadata && (
                                    <button onClick={onRecoverMetadata} className="text-amethyst-600 dark:text-amethyst-400 hover:text-amethyst-500 p-1.5 rounded bg-amethyst-100 dark:bg-amethyst-900/20 border border-amethyst-200 dark:border-amethyst-500/20 transition-colors" title="AI Prompt Recovery">
                                        <Wand2 className="w-3.5 h-3.5" />
                                    </button>
                                )}
                                {image.originalMetadata && !isLoading && hasModifications() && onRevertMetadata && (
                                    <button onClick={() => onRevertMetadata(image.id)} className="text-xs text-orange-600 dark:text-orange-400 hover:text-orange-500 flex items-center gap-1 transition-colors px-2 py-0.5 rounded bg-orange-100 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-500/20" title="Revert all metadata to original">
                                        <Undo2 className="w-3 h-3" />
                                    </button>
                                )}
                                <button onClick={handleCopyPrompt} className="text-sage-600 dark:text-sage-400 hover:text-sage-700 dark:hover:text-sage-300 text-xs flex items-center gap-1 transition-colors bg-sage-100 dark:bg-sage-500/10 px-2 py-1 rounded border border-sage-200 dark:border-sage-500/20">
                                    {copiedPrompt ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                                    {copiedPrompt ? "Copied" : "Copy"}
                                </button>
                            </div>
                        </div>
                        <div className={`p-4 bg-white dark:bg-zinc-950/50 rounded-xl border text-sm font-sans leading-relaxed max-h-48 overflow-y-auto shadow-inner transition-colors ${!isLoading && promptValue !== (image.originalMetadata?.positivePrompt ?? image.metadata.positivePrompt) ? 'border-amber-300 dark:border-amber-500/30 text-gray-800 dark:text-gray-200' : 'border-gray-200 dark:border-white/5 text-gray-700 dark:text-gray-300'}`}>
                            {promptValue ? (
                                <HighlightedPromptText text={promptValue} terms={searchHighlights?.positivePrompt} />
                            ) : (
                                <span className="text-gray-500 dark:text-gray-600 italic text-xs">No prompt data found. Use the wand icon to recover with AI or refresh from folder.</span>
                            )}
                        </div>
                    </div>

                    {/* Negative Prompt */}
                    {image.metadata.negativePrompt && (
                        <div>
                            <h3 className="text-xs font-bold uppercase text-gray-500 tracking-wider mb-2">Negative Prompt</h3>
                            <div className={`p-4 bg-white dark:bg-zinc-950/30 rounded-xl border text-xs leading-relaxed max-h-32 overflow-y-auto transition-colors ${isModified('negativePrompt') ? 'border-amber-300 dark:border-amber-500/30 text-amber-700 dark:text-amber-200/80 shadow-inner bg-amber-50/10' : 'border-gray-200 dark:border-white/5 text-red-600/80 dark:text-red-200/60 font-sans'}`}>
                                <HighlightedPromptText text={image.metadata.negativePrompt} terms={searchHighlights?.negativePrompt} />
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
                    <div className={`border rounded-xl bg-white/50 dark:bg-zinc-800/30 overflow-hidden ${isGenDataModified() ? 'border-amber-300 dark:border-amber-500/30' : 'border-gray-200 dark:border-white/5'}`}>
                        <button onClick={toggleGenData} className="w-full flex items-center justify-between p-3 bg-gray-50/50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                            <div className="flex items-center gap-2">
                                <Settings2 className="w-3.5 h-3.5 text-gray-500" />
                                <h3 className="text-xs font-bold uppercase text-gray-500 tracking-wider">Generation Data</h3>
                                {isGenDataModified() && !isLoading && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 ml-1" />}
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

                                    {/* TOOL ROW */}
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

                                    {/* Model Row */}
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
                                                    <button onClick={() => { onUpdateModel && onUpdateModel(image.id, editedModel); setIsEditingModel(false); setIsCustomModel(false); }} className="px-2 py-1 text-xs bg-sage-600 hover:bg-sage-500 text-white rounded transition-colors flex items-center gap-1">
                                                        <Check className="w-3 h-3" /> Save
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <div className="text-sm text-sage-800 dark:text-sage-200 truncate font-medium font-sans" title={image.metadata.overrideModel || image.metadata.model}>
                                                    {formatModelName(image.metadata.overrideModel || image.metadata.model)}
                                                </div>
                                                {image.metadata.overrideModel && <div className="text-[10px] text-amber-600 dark:text-amber-500 bg-amber-100 dark:bg-amber-900/20 px-1.5 rounded border border-amber-200 dark:border-amber-500/20">Override</div>}
                                            </div>
                                        )}
                                    </div>

                                    <ParamItem label="Sampler" value={image.metadata.sampler || 'Unknown'} isModified={isModified('sampler')} />
                                    <ParamItem label="Steps" value={(image.metadata.steps ?? 0).toString()} isModified={isModified('steps')} />
                                    <ParamItem label="CFG Scale" value={(image.metadata.cfg ?? 0).toString()} isModified={isModified('cfg')} />
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

                    {/* Resources & Addons */}
                    {(image.metadata.loras || image.metadata.controlNets || image.metadata.ipAdapters || image.metadata.embeddings || image.metadata.hypernetworks) && (
                        <div className="bg-white dark:bg-zinc-900/40 border border-gray-200 dark:border-white/5 rounded-xl p-4">
                            <ResourceSection title="LoRAs" items={image.metadata.loras || []} icon={Puzzle} onSearch={onSearch} onClose={onClose} />
                            <ResourceSection title="Embeddings" items={image.metadata.embeddings || []} icon={Code} onSearch={onSearch} onClose={onClose} />
                            <ResourceSection title="Hypernetworks" items={image.metadata.hypernetworks || []} icon={Sparkles} onSearch={onSearch} onClose={onClose} />
                            <ResourceSection title="ControlNet" items={image.metadata.controlNets || []} icon={Target} onSearch={onSearch} onClose={onClose} />
                            <ResourceSection title="IP-Adapters" items={image.metadata.ipAdapters || []} icon={Link} onSearch={onSearch} onClose={onClose} />
                        </div>
                    )}

                    {/* Raw Inspector */}
                    <MetadataRawInspector image={image} />
                </div>
            </div>

            {/* AI Tools Footer */}
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
                            <span className="text-[10px] text-gray-500 dark:text-zinc-400 group-hover:text-amethyst-500">
                                {isAnalyzing ? "Analyzing..." : "Get insights"}
                            </span>
                            {isAnalyzing ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-amethyst-500 border-t-transparent" /> : <Wand2 className="w-4 h-4 text-amethyst-500" />}
                        </div>
                    </button>

                    <button
                        onClick={onGenerateVariations} disabled={isAnalyzing}
                        className="p-4 bg-white/60 dark:bg-zinc-800/40 rounded-xl border border-gray-200 dark:border-white/5 hover:border-amethyst-300 dark:hover:border-amethyst-500/30 transition-all flex flex-col justify-between h-24 text-left group"
                    >
                        <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Variations</span>
                        <div className="flex items-center justify-between w-full">
                            <span className="text-[10px] text-gray-500 dark:text-zinc-400 group-hover:text-amethyst-500">
                                {isAnalyzing ? "Creating..." : "Create twists"}
                            </span>
                            {isAnalyzing ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-amethyst-500 border-t-transparent" /> : <Shuffle className="w-4 h-4 text-amethyst-500" />}
                        </div>
                    </button>
                </div>
            </div>
        </>
    );
};
