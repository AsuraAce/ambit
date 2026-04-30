import * as React from 'react';
import { Workflow } from 'lucide-react';
import { AIImage, Collection, GeneratorTool } from '../../../types';
import { WorkflowInspector } from './WorkflowInspector';
import { getFilename } from '../../../utils/pathUtils';
import { formatModelName } from '../../../utils/formatUtils';
import { MetadataInfoTab } from './metadata/MetadataInfoTab';
import { MetadataEditTab } from './metadata/MetadataEditTab';
import type { PromptHighlightSpec } from '../utils/searchHighlights';

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
    isLoading?: boolean;
    searchHighlights?: PromptHighlightSpec;
}

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
    isPaletteLoading,
    isLoading,
    searchHighlights
}) => {
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
                                ? formatModelName(image.metadata.overrideModel || image.metadata.model)
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
                    (tab !== 'workflow' || image.metadata.workflowJson || image.metadata.hasWorkflowHint !== false) && (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-all rounded-lg flex items-center justify-center gap-2 ${activeTab === tab ? 'text-white bg-sage-600 shadow-lg shadow-sage-500/20' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5'}`}
                        >
                            {tab === 'workflow' && (
                                <Workflow className="w-3 h-3" />
                            )}
                            {tab}
                        </button>
                    )
                ))}
            </div>

            {/* Content using new components */}
            <div className="flex-1 flex flex-col min-h-0 bg-gray-50/50 dark:bg-zinc-900/50 relative">

                {activeTab === 'info' && (
                    <MetadataInfoTab
                        image={image}
                        promptValue={promptValue}
                        setPromptValue={setPromptValue}
                        negativePromptValue={negativePromptValue}
                        palette={palette}
                        isPaletteLoading={isPaletteLoading}
                        onSearch={onSearch}
                        onClose={onClose}
                        onRecoverMetadata={onRecoverMetadata}
                        onRevertMetadata={onRevertMetadata}
                        onUpdateModel={onUpdateModel}
                        onUpdateTool={onUpdateTool}
                        onAIAnalysis={onAIAnalysis}
                        onGenerateVariations={onGenerateVariations}
                        isAnalyzing={isAnalyzing}
                        onOpenAIResult={onOpenAIResult}
                        isLoading={isLoading}
                        searchHighlights={searchHighlights}
                    />
                )}

                {activeTab === 'edit' && (
                    <MetadataEditTab
                        image={image}
                        collections={collections}
                        availableTags={availableTags}
                        notes={notes}
                        setNotes={setNotes}
                        promptValue={promptValue}
                        setPromptValue={setPromptValue}
                        negativePromptValue={negativePromptValue}
                        setNegativePromptValue={setNegativePromptValue}
                        onAddToCollection={onAddToCollection}
                        onUpdatePrompt={onUpdatePrompt}
                        onUpdateNegativePrompt={onUpdateNegativePrompt}
                        onUpdateNotes={onUpdateNotes}
                    />
                )}

                {activeTab === 'workflow' && <WorkflowInspector image={image} />}

            </div>
        </div>
    );
};
