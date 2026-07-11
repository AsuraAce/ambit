import * as React from 'react';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../../types';
import { MetadataSidebar } from '../MetadataSidebar';

const captures = vi.hoisted(() => ({ info: vi.fn(), edit: vi.fn(), workflow: vi.fn() }));
vi.mock('../metadata/MetadataInfoTab', () => ({ MetadataInfoTab: (props: Record<string, unknown>) => { captures.info(props); return <div>info-content</div>; } }));
vi.mock('../metadata/MetadataEditTab', () => ({ MetadataEditTab: (props: Record<string, unknown>) => { captures.edit(props); return <div>edit-content</div>; } }));
vi.mock('../WorkflowInspector', () => ({ WorkflowInspector: (props: Record<string, unknown>) => { captures.workflow(props); return <div>workflow-content</div>; } }));

const image = (metadata: Partial<AIImage['metadata']> = {}): AIImage => ({
    id: 'a', url: 'a.png', thumbnailUrl: 'thumb.png', filename: 'C:/images/portrait.final.png', timestamp: 1,
    width: 100, height: 200, isFavorite: false, isPinned: false,
    metadata: { tool: GeneratorTool.COMFYUI, model: 'flux_dev', seed: 1, steps: 1, cfg: 1, sampler: '', positivePrompt: '', negativePrompt: '', ...metadata }
});
const setup = (activeTab: 'info' | 'edit' | 'workflow', target = image()) => {
    const props: React.ComponentProps<typeof MetadataSidebar> = {
        image: target, activeTab, setActiveTab: vi.fn(), collections: [], availableTags: [], notes: '', setNotes: vi.fn(),
        promptValue: 'prompt', setPromptValue: vi.fn(), negativePromptValue: 'negative', setNegativePromptValue: vi.fn(),
        onUpdateNotes: vi.fn(), onUpdatePrompt: vi.fn(), onUpdateNegativePrompt: vi.fn(), onUpdateModel: vi.fn(), onUpdateTool: vi.fn(),
        onAddToCollection: vi.fn(), onSearch: vi.fn(), onClose: vi.fn(), onRecoverMetadata: vi.fn(), onRevertMetadata: vi.fn(),
        onAIAnalysis: vi.fn(), onGenerateVariations: vi.fn(), isAnalyzing: false, onOpenAIResult: vi.fn(), palette: ['#fff'], isPaletteLoading: false
    };
    const result = render(<MetadataSidebar {...props} />);
    return { ...result, props };
};

describe('MetadataSidebar', () => {
    it('renders filename, model, all tabs, and forwards info contracts', () => {
        const { props } = setup('info', image({ workflowJson: '{}' }));
        expect(screen.getByText('portrait.final')).toBeTruthy();
        expect(screen.getByText('flux_dev')).toBeTruthy();
        expect(screen.getByText('info-content')).toBeTruthy();
        expect(captures.info).toHaveBeenCalledWith(expect.objectContaining({ image: props.image, promptValue: 'prompt', onAIAnalysis: props.onAIAnalysis }));
        fireEvent.click(screen.getByText('edit'));
        fireEvent.click(screen.getByText('workflow'));
        expect(props.setActiveTab).toHaveBeenNthCalledWith(1, 'edit');
        expect(props.setActiveTab).toHaveBeenNthCalledWith(2, 'workflow');
    });

    it('forwards edit and workflow content and hides unsupported workflow tabs', () => {
        const edit = setup('edit', image({ hasWorkflowHint: false }));
        expect(screen.getByText('edit-content')).toBeTruthy();
        expect(screen.queryByText('workflow')).toBeNull();
        expect(captures.edit).toHaveBeenCalledWith(expect.objectContaining({ notes: '', onAddToCollection: edit.props.onAddToCollection }));
        edit.unmount();

        const workflow = setup('workflow', image({ hasWorkflowHint: true }));
        expect(screen.getByText('workflow-content')).toBeTruthy();
        expect(captures.workflow).toHaveBeenCalledWith(expect.objectContaining({ image: workflow.props.image }));
    });

    it('uses override and hash labels and omits unknown model pills without a hash', () => {
        const override = setup('info', image({ model: 'Unknown', overrideModel: 'override_model' }));
        expect(screen.getByText('override_model')).toBeTruthy();
        override.unmount();

        const hashed = setup('info', image({ model: 'Unknown', modelHash: '1234567890abcdef' }));
        expect(screen.getByText('Hash: 12345678')).toBeTruthy();
        hashed.unmount();

        setup('info', image({ model: 'Unknown', modelHash: undefined, hasWorkflowHint: false }));
        expect(screen.queryByText(/Hash:/)).toBeNull();
    });
});
