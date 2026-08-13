import React, { useEffect, useRef, useState } from 'react';
import {
    Wand2, Undo2, Copy, Check, ClipboardList,
    Sparkles, Eye, Shuffle, Tag, Puzzle, Code, Target, Link, Plus
} from 'lucide-react';
import { AIImage, GeneratorTool } from '../../../../types';
import { ResourceSection } from './ResourceSection';
import { MetadataRawInspector } from './MetadataRawInspector';
import { HighlightedPromptText } from './HighlightedPromptText';
import type { PromptHighlightSpec } from '../../utils/searchHighlights';
import { TooltipButton } from '../../../../components/ui/InfoTooltip';
import { formatInvokeImageCategory, isKnownInvokeImageAsset } from '../../../../utils/invokeImageSource';
import { InvokeReferenceLinks } from './InvokeReferenceLinks';
import { MetadataTextAreaField } from './MetadataTextAreaField';
import { MetadataParameterList } from './MetadataParameterList';
import { MetadataSectionHeader } from './MetadataSectionHeader';
import { getModelPresentation } from './modelPresentation';
import { MetadataGeneratorField } from './MetadataGeneratorField';
import { MetadataModelField } from './MetadataModelField';
import { MetadataDisclosureSection } from './MetadataDisclosureSection';
import type { MetadataDisclosureController } from '../../hooks/useMetadataDisclosureState';

interface MetadataInfoTabProps {
    image: AIImage;
    promptValue: string;
    setPromptValue: (s: string) => void;
    negativePromptValue: string;
    setNegativePromptValue: (value: string) => void;
    availableTags: string[];
    modelOptions?: readonly string[];
    disclosure?: MetadataDisclosureController;
    onUpdatePrompt?: (id: string, prompt: string) => void;
    onUpdateNegativePrompt?: (id: string, prompt: string) => void;
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
    onOpenReferencedImage?: (imageId: string) => Promise<boolean>;
}

export const MetadataInfoTab = ({
    image,
    promptValue,
    setPromptValue,
    negativePromptValue,
    setNegativePromptValue,
    availableTags,
    modelOptions = [],
    disclosure,
    onUpdatePrompt,
    onUpdateNegativePrompt,
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
    searchHighlights,
    onOpenReferencedImage
}: MetadataInfoTabProps) => {
    // Feedback State
    const [copiedPrompt, setCopiedPrompt] = useState(false);
    const [copiedData, setCopiedData] = useState(false);
    const [isPromptDirty, setIsPromptDirty] = useState(false);
    const [isNegativePromptDirty, setIsNegativePromptDirty] = useState(false);
    const [showOriginalPrompt, setShowOriginalPrompt] = useState(false);
    const [promptSuggestions, setPromptSuggestions] = useState<string[]>([]);
    const promptDraftRef = useRef(promptValue);
    const negativePromptDraftRef = useRef(negativePromptValue);

    // --- Helpers ---
    useEffect(() => {
        setIsPromptDirty(false);
        setIsNegativePromptDirty(false);
        setShowOriginalPrompt(false);
        setPromptSuggestions([]);
    }, [image.id]);

    useEffect(() => {
        promptDraftRef.current = promptValue;
    }, [promptValue]);

    useEffect(() => {
        negativePromptDraftRef.current = negativePromptValue;
    }, [negativePromptValue]);

    const isModified = (key: keyof typeof image.metadata) => {
        if (!image.originalMetadata || isLoading) return false;
        const cur = image.metadata[key];
        const orig = image.originalMetadata[key];

        if (cur === orig) return false;

        // Handle equivalent empty values (null, undefined, empty string)
        // CRITICAL: We also treat "Unknown" as empty to avoid modification flags for unresolved models
        const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (typeof v === 'string' && v.toLowerCase() === 'unknown');

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

        // Final fallback: standard comparison (already checked cur === orig above)
        return true;
    };

    const hasModifications = () => {
        return (
            isModified('positivePrompt') ||
            isModified('negativePrompt')
        );
    };

    const smartTags = (typeof image.metadata.positivePrompt === 'string')
        ? image.metadata.positivePrompt.split(',').map(t => t.trim()).filter(t => t.length > 2 && t.length < 30 && !t.startsWith('score_')).slice(0, 15)
        : [];
    const invokeImageName = image.invokeImageName?.trim() || undefined;
    const invokeImageCategory = formatInvokeImageCategory(image.invokeImageCategory);
    const invokeImageOrigin = image.invokeImageOrigin?.trim() || undefined;
    const hasInvokeSource = Boolean(invokeImageName || invokeImageCategory || invokeImageOrigin);
    const isInvokeImageAsset = isKnownInvokeImageAsset(image.invokeImageCategory);
    const modelPresentation = getModelPresentation(image.metadata);

    const handleCopyPrompt = () => {
        navigator.clipboard.writeText(promptValue);
        setCopiedPrompt(true);
        setTimeout(() => setCopiedPrompt(false), 2000);
    };

    const handlePromptChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const nextValue = event.target.value;
        promptDraftRef.current = nextValue;
        setPromptValue(nextValue);
        setIsPromptDirty(true);
        const lastToken = nextValue.split(',').pop()?.trim().toLowerCase();
        setPromptSuggestions(lastToken && lastToken.length > 1
            ? availableTags.filter(tag => tag.toLowerCase().includes(lastToken)
                && tag.toLowerCase() !== lastToken).slice(0, 5)
            : []);
    };

    const savePrompt = () => {
        if (!showOriginalPrompt && isPromptDirty) {
            onUpdatePrompt?.(image.id, promptDraftRef.current);
            setIsPromptDirty(false);
        }
        setTimeout(() => setPromptSuggestions([]), 200);
    };

    const saveNegativePrompt = () => {
        if (isNegativePromptDirty) {
            onUpdateNegativePrompt?.(image.id, negativePromptDraftRef.current);
            setIsNegativePromptDirty(false);
        }
    };

    const handleParseClipboard = async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (!text || !text.includes('Steps:')) return;
            const lines = text.split('\n');
            let positive = '';
            let negative = '';
            let state = 0;
            for (const line of lines) {
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
            if (md.seed !== undefined) params.push(`Seed: ${md.seed}`);
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

    const invokeProvenance = (
        <>
            {hasInvokeSource ? (
                <section className="rounded-xl border border-gray-200 bg-white/50 p-4 dark:border-white/5 dark:bg-zinc-800/30" aria-labelledby="invoke-source-heading">
                    <MetadataSectionHeader title="Source" icon={Link} headingId="invoke-source-heading" className="mb-3" />
                    <dl className="space-y-2 text-xs">
                        <div className="flex items-start justify-between gap-4">
                            <dt className="text-gray-400">System</dt>
                            <dd className="text-right font-medium text-gray-700 dark:text-gray-200">InvokeAI</dd>
                        </div>
                        {invokeImageName ? (
                            <div className="flex items-start justify-between gap-4">
                                <dt className="text-gray-400">Image name</dt>
                                <dd className="min-w-0 break-all text-right font-mono text-gray-700 dark:text-gray-200">{invokeImageName}</dd>
                            </div>
                        ) : null}
                        {invokeImageCategory ? (
                            <div className="flex items-start justify-between gap-4">
                                <dt className="text-gray-400">Category</dt>
                                <dd className="min-w-0 break-words text-right font-medium text-gray-700 dark:text-gray-200">{invokeImageCategory}</dd>
                            </div>
                        ) : null}
                        {invokeImageOrigin ? (
                            <div className="flex items-start justify-between gap-4">
                                <dt className="text-gray-400">Origin</dt>
                                <dd className="min-w-0 break-words text-right font-medium text-gray-700 dark:text-gray-200">{invokeImageOrigin}</dd>
                            </div>
                        ) : null}
                    </dl>
                </section>
            ) : null}

            {onOpenReferencedImage ? (
                <InvokeReferenceLinks imageId={image.id} onOpenImage={onOpenReferencedImage} />
            ) : null}
        </>
    );

    return (
        <>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="space-y-6 flex-1">

                    <MetadataTextAreaField
                        kind="positivePrompt"
                        value={showOriginalPrompt ? (image.originalMetadata?.positivePrompt ?? '') : promptValue}
                        onChange={handlePromptChange}
                        onBlur={savePrompt}
                        readOnly={showOriginalPrompt || !onUpdatePrompt}
                        isDirty={isPromptDirty}
                        source={isModified('positivePrompt') ? 'user_override' : undefined}
                        headerAction={<div className="flex items-center gap-1">
                            {image.originalMetadata && image.originalMetadata.positivePrompt !== image.metadata.positivePrompt ? (
                                <div className="flex rounded-lg border border-white/10 bg-white/5 p-0.5">
                                    <button type="button" onClick={() => setShowOriginalPrompt(false)} className={`rounded px-2 py-0.5 text-[10px] font-bold ${!showOriginalPrompt ? 'bg-sage-600 text-white' : 'text-zinc-500'}`}>Current</button>
                                    <button type="button" onClick={() => setShowOriginalPrompt(true)} className={`rounded px-2 py-0.5 text-[10px] font-bold ${showOriginalPrompt ? 'bg-sage-600 text-white' : 'text-zinc-500'}`}>Original</button>
                                </div>
                            ) : null}
                            {onRecoverMetadata ? <TooltipButton label="Recover Prompt with AI" content="Recover Prompt with AI" onClick={onRecoverMetadata} className="rounded p-1.5 text-amethyst-400 hover:bg-white/5"><Wand2 className="h-3.5 w-3.5" /></TooltipButton> : null}
                            {(image.metadata.tool === GeneratorTool.AUTOMATIC1111
                                || image.metadata.tool === GeneratorTool.FORGE
                                || image.metadata.tool === GeneratorTool.UNKNOWN) ? <TooltipButton label="Parse Prompt from Clipboard" content="Parse Prompt from Clipboard" onClick={() => void handleParseClipboard()} className="rounded p-1.5 text-sage-400 hover:bg-white/5"><ClipboardList className="h-3.5 w-3.5" /></TooltipButton> : null}
                            {image.originalMetadata && !isLoading && hasModifications() && onRevertMetadata ? <TooltipButton label="Revert All Metadata to Original" content="Revert All Metadata to Original" onClick={() => onRevertMetadata(image.id)} className="rounded p-1.5 text-orange-400 hover:bg-white/5"><Undo2 className="h-3.5 w-3.5" /></TooltipButton> : null}
                            <TooltipButton label="Copy Prompt" content="Copy Prompt" onClick={handleCopyPrompt} className="rounded p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-300">{copiedPrompt ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}</TooltipButton>
                        </div>}
                        overlay={promptSuggestions.length > 0 ? <div className="absolute bottom-full left-0 right-0 z-20 mb-1 overflow-hidden rounded-lg border border-white/10 bg-zinc-900 shadow-xl">
                            {promptSuggestions.map(suggestion => <button key={suggestion} type="button" className="group flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-white/5" onClick={() => {
                                const parts = promptValue.split(',');
                                parts.pop();
                                setPromptValue([...parts, suggestion].join(', ') + ', ');
                                setIsPromptDirty(true);
                                setPromptSuggestions([]);
                            }}><span className="font-mono text-zinc-300">{suggestion}</span><Plus className="h-3 w-3 text-zinc-500 group-hover:text-sage-400" /></button>)}
                        </div> : null}
                    />

                    {searchHighlights?.positivePrompt?.length && promptValue ? <div className="rounded-lg border border-sage-500/20 bg-sage-500/5 p-3 text-xs text-zinc-300"><HighlightedPromptText text={promptValue} terms={searchHighlights.positivePrompt} /></div> : null}

                    <MetadataTextAreaField
                        kind="negativePrompt"
                        value={negativePromptValue}
                        onChange={event => { negativePromptDraftRef.current = event.target.value; setNegativePromptValue(event.target.value); setIsNegativePromptDirty(true); }}
                        onBlur={saveNegativePrompt}
                        readOnly={!onUpdateNegativePrompt}
                        isDirty={isNegativePromptDirty}
                        source={isModified('negativePrompt') ? 'user_override' : undefined}
                    />

                    {searchHighlights?.negativePrompt?.length && negativePromptValue ? <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-zinc-300"><HighlightedPromptText text={negativePromptValue} terms={searchHighlights.negativePrompt} /></div> : null}

                    {isInvokeImageAsset ? invokeProvenance : null}

                    <MetadataGeneratorField
                        value={image.metadata.tool}
                        modified={isModified('tool')}
                        onSave={onUpdateTool ? value => onUpdateTool(image.id, value) : undefined}
                    />

                    <MetadataModelField
                        presentation={modelPresentation}
                        options={modelOptions}
                        modified={isModified('model') || isModified('overrideModel')}
                        onSave={onUpdateModel ? value => onUpdateModel(image.id, value) : undefined}
                    />

                    <MetadataParameterList rows={[
                        { label: 'Seed', value: image.metadata.seed?.toString() ?? 'Unknown', modified: isModified('seed') },
                        { label: 'Steps', value: image.metadata.steps > 0 ? image.metadata.steps.toString() : 'Unknown', modified: isModified('steps') },
                        { label: 'CFG', value: image.metadata.cfg > 0 ? image.metadata.cfg.toString() : 'Unknown', modified: isModified('cfg') },
                        { label: 'Sampler', value: image.metadata.sampler || 'Unknown', modified: isModified('sampler') },
                        { label: 'VAE', value: image.metadata.vae || 'Unknown', modified: isModified('vae'), optional: true },
                        { label: 'Clip Skip', value: image.metadata.clipSkip?.toString() || 'Unknown', modified: isModified('clipSkip'), optional: true },
                        { label: 'Denoising', value: image.metadata.denoisingStrength?.toString() || 'Unknown', modified: isModified('denoisingStrength'), optional: true },
                        { label: 'Hires Upscale', value: image.metadata.hiresUpscale?.toString() || 'Unknown', modified: isModified('hiresUpscale'), optional: true },
                        { label: 'Hires Steps', value: image.metadata.hiresSteps?.toString() || 'Unknown', modified: isModified('hiresSteps'), optional: true },
                        { label: 'Hires Upscaler', value: image.metadata.hiresUpscaler || 'Unknown', modified: isModified('hiresUpscaler'), optional: true },
                        { label: 'Model Hash', value: modelPresentation.isHashFallback ? 'Unknown' : (image.metadata.modelHash || 'Unknown'), optional: true },
                    ]} expanded={disclosure?.isExpanded('generationParameters')} onExpandedChange={expanded => disclosure?.setExpanded('generationParameters', expanded)} headerAction={
                        <TooltipButton label="Copy Parameters" content="Copy Parameters" onClick={handleCopyGenData} className="rounded p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-300">
                            {copiedData ? <Check className="h-3.5 w-3.5 text-green-500" /> : <ClipboardList className="h-3.5 w-3.5" />}
                        </TooltipButton>
                    } />

                    {/* Tags */}
                    {smartTags.length > 0 && (
                        <MetadataDisclosureSection title="Smart Tags" icon={Tag} count={smartTags.length} expanded={disclosure?.isExpanded('smartTags')} onExpandedChange={expanded => disclosure?.setExpanded('smartTags', expanded)}>
                            <div className="flex flex-wrap gap-2">
                                {smartTags.map((tag, i) => (
                                    <button key={i} onClick={() => { onSearch(tag); onClose(); }} className="px-2.5 py-1 text-xs bg-gray-100 dark:bg-zinc-800 hover:bg-sage-100 dark:hover:bg-sage-900/40 border border-gray-200 dark:border-white/5 rounded-lg transition-all truncate max-w-[150px] text-gray-600 dark:text-gray-400">
                                        {tag}
                                    </button>
                                ))}
                            </div>
                        </MetadataDisclosureSection>
                    )}

                    {/* Resources & Addons */}
                    {[
                        image.metadata.loras,
                        image.metadata.controlNets,
                        image.metadata.ipAdapters,
                        image.metadata.embeddings,
                        image.metadata.hypernetworks,
                    ].some(items => (items?.length ?? 0) > 0) && (
                        <>
                            <ResourceSection title="LoRAs" items={image.metadata.loras || []} icon={Puzzle} filterKind="lora" onSearch={onSearch} onClose={onClose} expanded={disclosure?.isExpanded('resource:loras')} onExpandedChange={expanded => disclosure?.setExpanded('resource:loras', expanded)} />
                            <ResourceSection title="Embeddings" items={image.metadata.embeddings || []} icon={Code} filterKind="embedding" onSearch={onSearch} onClose={onClose} expanded={disclosure?.isExpanded('resource:embeddings')} onExpandedChange={expanded => disclosure?.setExpanded('resource:embeddings', expanded)} />
                            <ResourceSection title="Hypernetworks" items={image.metadata.hypernetworks || []} icon={Sparkles} filterKind="hypernet" onSearch={onSearch} onClose={onClose} expanded={disclosure?.isExpanded('resource:hypernetworks')} onExpandedChange={expanded => disclosure?.setExpanded('resource:hypernetworks', expanded)} />
                            <ResourceSection title="ControlNets" items={image.metadata.controlNets || []} icon={Target} filterKind="controlnet" onSearch={onSearch} onClose={onClose} expanded={disclosure?.isExpanded('resource:controlnets')} onExpandedChange={expanded => disclosure?.setExpanded('resource:controlnets', expanded)} />
                            <ResourceSection title="IP adapters" items={image.metadata.ipAdapters || []} icon={Link} filterKind="ipadapter" onSearch={onSearch} onClose={onClose} expanded={disclosure?.isExpanded('resource:ip-adapters')} onExpandedChange={expanded => disclosure?.setExpanded('resource:ip-adapters', expanded)} />
                        </>
                    )}

                    {!isInvokeImageAsset ? invokeProvenance : null}

                    {/* Raw Inspector */}
                    <MetadataRawInspector image={image} />
                </div>
            </div>

            {/* AI Tools Footer */}
            <div className="shrink-0 p-4 border-t border-gray-200 dark:border-white/5 bg-white dark:bg-zinc-900 z-10 shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">
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
