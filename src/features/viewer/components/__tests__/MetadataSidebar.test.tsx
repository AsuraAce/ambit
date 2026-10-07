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
    it.each([
        ['Canon', 'Canon PowerShot S5 IS', 'Canon PowerShot S5 IS'],
        ['CANON', 'Canon PowerShot S5 IS', 'Canon PowerShot S5 IS'],
        ['Canon', 'Canon', 'Canon'],
        ['Canon', 'EOS R6', 'Canon EOS R6'],
        ['Canon', 'Canonical Camera', 'Canon Canonical Camera'],
    ])('shows make %s and model %s without repeating an included manufacturer', (cameraMake, cameraModel, label) => {
        setup('metadata', { ...image(), sourceKind: 'photograph', photoMetadata: {
            cameraMake, cameraModel, capturedAt: null, captureTimeRaw: null,
            lensMake: null, lensModel: null, focalLengthMm: null, focalLength35Mm: null,
            apertureFNumber: null, exposureTimeSeconds: null, iso: null, orientation: null,
            artist: null, copyright: null, gpsLatitude: null, gpsLongitude: null,
        } });
        expect(screen.getByText(label)).toBeTruthy();
    });

    it('does not flash an empty metadata card while photo metadata is still loading', () => {
        const target = { ...image(), sourceKind: 'photograph' as const, detectedSourceKind: 'photograph' as const };
        const { props, rerender } = setup('metadata', target);
        rerender(<MetadataSidebar {...props} isLoading />);
        expect(screen.getByRole('tab', { name: 'Metadata' }).getAttribute('aria-selected')).toBe('true');
        expect(screen.queryByText('No supported metadata found')).toBeNull();
        rerender(<MetadataSidebar {...props} isLoading={false} image={{ ...target, photoMetadata: {
            cameraModel: 'Loaded camera', cameraMake: null, capturedAt: null, captureTimeRaw: null,
            lensMake: null, lensModel: null, focalLengthMm: null, focalLength35Mm: null,
            apertureFNumber: null, exposureTimeSeconds: null, iso: null, orientation: null,
            artist: null, copyright: null, gpsLatitude: null, gpsLongitude: null,
        } }} />);
        expect(screen.getByText('Loaded camera')).toBeTruthy();
        expect(screen.queryByText('No supported metadata found')).toBeNull();
        rerender(<MetadataSidebar {...props} isLoading={false} />);
        expect(screen.getByText('No supported metadata found')).toBeTruthy();
    });

    it('keeps Other file information in shared Details and explicitly explains unsupported metadata', () => {
        const { props, rerender } = setup('metadata', { ...image(), sourceKind: 'other', detectedSourceKind: 'other' });
        const emptyHeading = screen.getByRole('heading', { name: 'No supported metadata found' });
        expect(emptyHeading).toBeTruthy();
        expect(emptyHeading.parentElement?.classList.contains('text-center')).toBe(true);
        expect(emptyHeading.parentElement?.parentElement?.classList.contains('min-h-full')).toBe(false);
        expect(screen.getByText('File information is available in Details.')).toBeTruthy();
        expect(screen.queryByRole('tab', { name: 'Workflow' })).toBeNull();
        rerender(<MetadataSidebar {...props} activeTab="details" />);
        expect(screen.getByText('details-content')).toBeTruthy();
    });

    it('uses the shared image title and Details, Metadata, and Workflow tabs', () => {
        const { props } = setup('details', image({ workflowJson: '{}' }));
        expect(screen.queryByRole('heading', { name: 'Image' })).toBeNull();
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

    it('falls back to Metadata when navigation removes the active Workflow tab', () => {
        const workflowImage = image({ workflowJson: '{}' });
        const { props, rerender } = setup('workflow', workflowImage);
        expect(screen.getByText('workflow-content')).toBeTruthy();

        const nextImage = { ...image({ hasWorkflowHint: false }), id: 'b' };
        rerender(<MetadataSidebar {...props} image={nextImage} activeTab="workflow" />);

        expect(screen.queryByRole('tab', { name: 'Workflow' })).toBeNull();
        expect(screen.getByRole('tab', { name: 'Metadata' }).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByText('metadata-content')).toBeTruthy();
        expect(screen.queryByText('workflow-content')).toBeNull();
        expect(props.setActiveTab).not.toHaveBeenCalled();
    });

    it('separates photo Metadata from shared Details without generation controls', () => {
        const { props, rerender } = setup('metadata', {
            ...image({ workflowJson: '{}' }),
            detectedSourceKind: 'photograph',
            sourceKind: 'photograph',
            width: 4000,
            height: 6000,
            photoMetadata: {
                capturedAt: { local: '2026:07:29 14:15:16', offset: '+02:00', subsecond: null },
                captureTimeRaw: '2026:07:29 14:15:16',
                cameraMake: 'Test Camera Co', cameraModel: 'Camera One',
                lensMake: null, lensModel: 'Prime 50', focalLengthMm: 50,
                focalLength35Mm: 50, apertureFNumber: 2.8, exposureTimeSeconds: 0.008,
                iso: 200, orientation: 6, artist: null, copyright: null,
                gpsLatitude: 51.5, gpsLongitude: -0.12
            }
        });

        expect(screen.getByText('Test Camera Co Camera One')).toBeTruthy();
        expect(screen.queryByText('Camera One')).toBeNull();
        expect(screen.getByRole('tab', { name: 'Details' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Metadata' })).toBeTruthy();
        expect(screen.queryByRole('tab', { name: 'Library' })).toBeNull();
        expect(screen.queryByText('workflow')).toBeNull();
        expect(screen.queryByText('info-content')).toBeNull();
        expect(screen.getByRole('button', { name: 'Exposure settings' })).toBeTruthy();
        expect(screen.queryByText('Dimensions')).toBeNull();
        expect(screen.queryByText('File size')).toBeNull();
        expect(screen.queryByText('Modified')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Exposure settings' }));
        expect(screen.queryByText('1/125 s')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Exposure settings' }));
        expect(screen.getByText('1/125 s')).toBeTruthy();
        rerender(<MetadataSidebar {...props} activeTab="workflow" />);
        expect(screen.getByRole('tab', { name: 'Metadata' }).getAttribute('aria-selected')).toBe('true');
        expect(props.setActiveTab).not.toHaveBeenCalled();
        expect(screen.getByText('Test Camera Co Camera One')).toBeTruthy();
        rerender(<MetadataSidebar {...props} />);
        expect(screen.queryByText('ComfyUI')).toBeNull();
        expect(screen.queryByText('flux_dev')).toBeNull();
        const gps = screen.getByRole('button', { name: 'Local GPS coordinates' });
        expect(gps.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByText('51.500000, -0.120000')).toBeNull();
        fireEvent.click(gps);
        expect(screen.getByText('51.500000, -0.120000')).toBeTruthy();
        rerender(<MetadataSidebar {...props} image={{ ...props.image, id: 'next-photo' }} />);
        expect(screen.getByRole('button', { name: 'Local GPS coordinates' }).getAttribute('aria-expanded')).toBe('false');
        rerender(<MetadataSidebar {...props} activeTab="details" />);
        expect(screen.queryByText('Test Camera Co Camera One')).toBeNull();
        expect(screen.getByText('details-content')).toBeTruthy();
    });
});
