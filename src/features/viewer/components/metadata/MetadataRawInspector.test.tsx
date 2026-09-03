import * as React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import type { AIImage } from '../../../../types';
import { MetadataRawInspector } from './MetadataRawInspector';

const imageFixture = (metadata: Record<string, unknown>): AIImage => ({
    id: 'image',
    filename: 'image.png',
    url: '',
    thumbnailUrl: '',
    timestamp: 1,
    width: 100,
    height: 100,
    isFavorite: false,
    metadata: {
        tool: 'Unknown',
        model: 'Model',
        steps: 20,
        cfg: 7,
        sampler: 'Euler',
        positivePrompt: 'portrait',
        negativePrompt: '',
        ...metadata
    }
} as AIImage);

describe('MetadataRawInspector', () => {
    beforeEach(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: vi.fn().mockResolvedValue(undefined) },
        });
    });

    it('toggles parsed metadata visibility and active-tab styling', () => {
        render(<MetadataRawInspector image={imageFixture({ rawParameters: 'raw source' })} />);

        expect(screen.queryByText(/"model": "Model"/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /view internal metadata/i }));

        expect(screen.getByText(/"model": "Model"/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Parsed' }).className).toContain('bg-sage-100');
        expect(screen.getByRole('button', { name: 'Text' }).className).toContain('text-gray-500');

        fireEvent.click(screen.getByRole('button', { name: /hide internal metadata/i }));
        expect(screen.queryByText(/"model": "Model"/)).toBeNull();
    });

    it('switches between raw source and valid formatted workflow JSON', () => {
        render(<MetadataRawInspector image={imageFixture({
            rawParameters: 'steps=20',
            workflowJson: '{"nodes":[1,2]}'
        })} />);
        fireEvent.click(screen.getByRole('button', { name: /view internal metadata/i }));

        fireEvent.click(screen.getByRole('button', { name: 'Text' }));
        expect(screen.getByText('steps=20')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Text' }).className).toContain('bg-sage-100');
        expect(screen.getByRole('button', { name: 'Parsed' }).className).toContain('text-gray-500');

        fireEvent.click(screen.getByRole('button', { name: 'Parsed' }));
        expect(screen.getByText(/"model": "Model"/)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
        expect(screen.getByText(/"nodes": \[/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'JSON' }).className).toContain('bg-sage-100');
        expect(screen.getByRole('button', { name: 'Text' }).className).toContain('text-gray-500');
        fireEvent.click(screen.getByRole('button', { name: 'Copy workflow JSON' }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{\n  "nodes": [\n    1,\n    2\n  ]\n}');
    });

    it('shows malformed workflow JSON verbatim', () => {
        render(<MetadataRawInspector image={imageFixture({ workflowJson: '{broken json' })} />);
        fireEvent.click(screen.getByRole('button', { name: /view internal metadata/i }));
        fireEvent.click(screen.getByRole('button', { name: 'JSON' }));

        expect(screen.getByText('{broken json')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Copy workflow JSON' }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{broken json');
    });

    it('falls back when raw source and workflow JSON are absent', () => {
        render(<MetadataRawInspector image={imageFixture({})} />);
        fireEvent.click(screen.getByRole('button', { name: /view internal metadata/i }));

        expect(screen.queryByRole('button', { name: 'JSON' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Text' }));
        expect(screen.getByText('No raw source available.')).toBeTruthy();
        expect((screen.getByRole('button', { name: 'Copy source metadata' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('copies the active representation and temporarily confirms the action', async () => {
        vi.useFakeTimers();
        const view = render(<MetadataRawInspector image={imageFixture({ rawParameters: 'steps=20' })} />);
        fireEvent.click(screen.getByRole('button', { name: /view internal metadata/i }));

        fireEvent.click(screen.getByRole('button', { name: 'Copy parsed metadata' }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('"model": "Model"'));
        await act(async () => undefined);
        expect(view.container.querySelector('.lucide-check')).toBeTruthy();

        act(() => vi.advanceTimersByTime(2000));
        expect(view.container.querySelector('.lucide-check')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Text' }));
        fireEvent.click(screen.getByRole('button', { name: 'Copy source metadata' }));
        expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('steps=20');
    });
});
