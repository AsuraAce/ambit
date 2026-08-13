import * as React from 'react';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../../types';
import { MetadataSidebar } from '../MetadataSidebar';

const captures = vi.hoisted(() => ({ details: vi.fn(), metadata: vi.fn(), workflow: vi.fn() }));
vi.mock('../metadata/ImageDetailsTab', () => ({ ImageDetailsTab: (props: Record<string, unknown>) => { captures.details(props); return <div>details-content</div>; } }));
vi.mock('../metadata/MetadataInfoTab', () => ({ MetadataInfoTab: (props: Record<string, unknown>) => { captures.metadata(props); return <div>metadata-content</div>; } }));
vi.mock('../WorkflowInspector', () => ({ WorkflowInspector: (props: Record<string, unknown>) => { captures.workflow(props); return <div>workflow-content</div>; } }));

const image = (metadata: Partial<AIImage['metadata']> = {}): AIImage => ({
    id: 'a', url: 'a.png', thumbnailUrl: 'thumb.png', filename: 'C:/images/portrait.final.png', timestamp: 1,
    width: 100, height: 200, isFavorite: false, isPinned: false,
    metadata: { tool: GeneratorTool.COMFYUI, model: 'flux_dev', seed: 1, steps: 1, cfg: 1, sampler: '', positivePrompt: '', negativePrompt: '', ...metadata },
});

const setup = (activeTab: 'details' | 'metadata' | 'workflow', target = image()) => {
    const props: React.ComponentProps<typeof MetadataSidebar> = {
        image: target, activeTab, setActiveTab: vi.fn(), collections: [], availableTags: [], notes: '', setNotes: vi.fn(),
        promptValue: 'prompt', setPromptValue: vi.fn(), negativePromptValue: 'negative', setNegativePromptValue: vi.fn(),
        onUpdateNotes: vi.fn(), onUpdatePrompt: vi.fn(), onUpdateNegativePrompt: vi.fn(), onUpdateModel: vi.fn(), onUpdateTool: vi.fn(),
        onSetCollectionMembership: vi.fn().mockResolvedValue(true), onSearch: vi.fn(), onClose: vi.fn(), onRecoverMetadata: vi.fn(), onRevertMetadata: vi.fn(),
        onAIAnalysis: vi.fn(), onGenerateVariations: vi.fn(), isAnalyzing: false, onOpenAIResult: vi.fn(), palette: ['#fff'], isPaletteLoading: false,
    };
    return { ...render(<MetadataSidebar {...props} />), props };
};

describe('MetadataSidebar', () => {
    it('uses the shared image title and Details, Metadata, and Workflow tabs', () => {
        const { props } = setup('details', image({ workflowJson: '{}' }));
        expect(screen.getByRole('heading', { name: 'Image' })).toBeTruthy();
        expect(screen.getByText('details-content')).toBeTruthy();
        expect(captures.details).toHaveBeenCalledWith(expect.objectContaining({ image: props.image, notes: '' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Workflow' }));
        expect(props.setActiveTab).toHaveBeenNthCalledWith(1, 'metadata');
        expect(props.setActiveTab).toHaveBeenNthCalledWith(2, 'workflow');
    });

    it('forwards metadata and workflow contracts and hides unsupported workflow tabs', () => {
        const metadata = setup('metadata', image({ hasWorkflowHint: false }));
        expect(screen.getByText('metadata-content')).toBeTruthy();
        expect(screen.getByText('metadata-content').parentElement?.className).toContain('flex-col');
        expect(screen.queryByRole('tab', { name: 'Workflow' })).toBeNull();
        expect(captures.metadata).toHaveBeenCalledWith(expect.objectContaining({ promptValue: 'prompt', onUpdatePrompt: metadata.props.onUpdatePrompt }));
        metadata.unmount();

        const workflow = setup('workflow', image({ hasWorkflowHint: true }));
        expect(screen.getByText('workflow-content')).toBeTruthy();
        expect(captures.workflow).toHaveBeenCalledWith(expect.objectContaining({ image: workflow.props.image }));
    });
});
