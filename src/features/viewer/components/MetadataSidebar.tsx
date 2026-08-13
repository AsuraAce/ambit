import * as React from 'react';
import type { AIImage, Collection, GeneratorTool } from '../../../types';
import type { PromptHighlightSpec } from '../utils/searchHighlights';
import { ImageDetailsTab } from './metadata/ImageDetailsTab';
import { MetadataInfoTab } from './metadata/MetadataInfoTab';
import { ViewerSidebarShell } from './ViewerSidebarShell';
import type { ViewerTabDefinition } from './ViewerTabs';
import { WorkflowInspector } from './WorkflowInspector';
import type { MetadataDisclosureController } from '../hooks/useMetadataDisclosureState';

type ImageViewerTab = 'details' | 'metadata' | 'workflow';

const IMAGE_VIEWER_TABS: readonly ViewerTabDefinition<ImageViewerTab>[] = [
    { id: 'details', label: 'Details' },
    { id: 'metadata', label: 'Metadata' },
    { id: 'workflow', label: 'Workflow' },
];
const IMAGE_VIEWER_TABS_WITHOUT_WORKFLOW = IMAGE_VIEWER_TABS.slice(0, 2);

interface MetadataSidebarProps {
    image: AIImage;
    activeTab: ImageViewerTab;
    setActiveTab: (tab: ImageViewerTab) => void;
    collections: Collection[];
    availableTags: string[];
    modelOptions?: readonly string[];
    disclosure?: MetadataDisclosureController;
    notes: string;
    setNotes: (value: string) => void;
    promptValue: string;
    setPromptValue: React.Dispatch<React.SetStateAction<string>>;
    negativePromptValue: string;
    setNegativePromptValue: React.Dispatch<React.SetStateAction<string>>;
    onUpdateNotes?: (imageId: string, notes: string) => void;
    onUpdatePrompt?: (imageId: string, prompt: string) => void;
    onUpdateNegativePrompt?: (imageId: string, negativePrompt: string) => void;
    onUpdateModel?: (imageId: string, newModel: string) => void;
    onUpdateTool?: (id: string, tool: GeneratorTool) => void;
    onSetCollectionMembership: (imageId: string, collectionId: string, shouldBelong: boolean) => Promise<boolean>;
    onSearch: (term: string) => void;
    onClose: () => void;
    onRecoverMetadata?: () => void;
    onRevertMetadata?: (id: string) => void;
    onAIAnalysis: () => void;
    onGenerateVariations: () => void;
    isAnalyzing: boolean;
    onOpenAIResult?: () => void;
    palette: string[];
    isPaletteLoading: boolean;
    isLoading?: boolean;
    searchHighlights?: PromptHighlightSpec;
    onOpenReferencedImage?: (imageId: string) => Promise<boolean>;
}

export const MetadataSidebar: React.FC<MetadataSidebarProps> = ({
    image,
    activeTab,
    setActiveTab,
    collections,
    availableTags,
    modelOptions,
    disclosure,
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
    onSetCollectionMembership,
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
    searchHighlights,
    onOpenReferencedImage,
}) => (
    <ViewerSidebarShell
        mediaLabel="Image"
        tabs={image.metadata.workflowJson || image.metadata.hasWorkflowHint !== false
            ? IMAGE_VIEWER_TABS
            : IMAGE_VIEWER_TABS_WITHOUT_WORKFLOW}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ariaLabel="Image viewer sections"
    >
        {activeTab === 'details' ? (
            <ImageDetailsTab
                image={image}
                collections={collections}
                notes={notes}
                setNotes={setNotes}
                onUpdateNotes={onUpdateNotes}
                onSetCollectionMembership={onSetCollectionMembership}
                palette={palette}
                isPaletteLoading={isPaletteLoading}
            />
        ) : null}

        {activeTab === 'metadata' ? (
            <MetadataInfoTab
                image={image}
                promptValue={promptValue}
                setPromptValue={setPromptValue}
                negativePromptValue={negativePromptValue}
                setNegativePromptValue={setNegativePromptValue}
                availableTags={availableTags}
                modelOptions={modelOptions}
                disclosure={disclosure}
                onUpdatePrompt={onUpdatePrompt}
                onUpdateNegativePrompt={onUpdateNegativePrompt}
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
                onOpenReferencedImage={onOpenReferencedImage}
            />
        ) : null}

        {activeTab === 'workflow' ? <WorkflowInspector image={image} /> : null}
    </ViewerSidebarShell>
);
