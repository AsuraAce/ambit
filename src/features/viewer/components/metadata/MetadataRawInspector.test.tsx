import * as React from 'react';
import { describe, expect, it } from 'vitest';
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
    });

    it('shows malformed workflow JSON verbatim', () => {
        render(<MetadataRawInspector image={imageFixture({ workflowJson: '{broken json' })} />);
        fireEvent.click(screen.getByRole('button', { name: /view internal metadata/i }));
        fireEvent.click(screen.getByRole('button', { name: 'JSON' }));

        expect(screen.getByText('{broken json')).toBeTruthy();
    });

    it('falls back when raw source and workflow JSON are absent', () => {
        render(<MetadataRawInspector image={imageFixture({})} />);
        fireEvent.click(screen.getByRole('button', { name: /view internal metadata/i }));

        expect(screen.queryByRole('button', { name: 'JSON' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Text' }));
        expect(screen.getByText('No raw source available.')).toBeTruthy();
    });
});
