import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../../types';
import type { StackGroup as StackGroupModel } from '../../../../hooks/useStacking';
import { StackGroup } from '../StackGroup';

const image = (id: string, timestamp: number, width: number, seed?: number): AIImage => ({
    id,
    url: `asset://${id}.png`,
    thumbnailUrl: `asset://${id}-thumb.webp`,
    filename: `${id}.png`,
    timestamp,
    width,
    height: 512,
    isFavorite: false,
    metadata: {
        tool: GeneratorTool.COMFYUI,
        model: 'flux',
        seed,
        steps: 20,
        cfg: 7,
        sampler: 'Euler',
        positivePrompt: '',
        negativePrompt: '',
    },
});

const group = (reason = 'Same workflow'): StackGroupModel => ({
    id: 'stack-1',
    baseImage: image('base', 30, 512),
    relatedImages: [image('early', 10, 768, 123456), image('late', 20, 640, 42)],
    reason,
    confidence: 0.9,
});

describe('StackGroup', () => {
    it('sorts selected candidates by timestamp when confirming', () => {
        const onConfirm = vi.fn();
        render(<StackGroup group={group()} onConfirm={onConfirm} />);

        expect(screen.getByText('Same workflow')).toBeTruthy();
        expect(screen.getByText('3 candidates found', { exact: false })).toBeTruthy();
        expect(screen.getAllByText('Upscale')).toHaveLength(1);
        expect(screen.getByText('?')).toBeTruthy();
        expect(screen.getByText('3456')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Group (3)' }));
        expect(onConfirm).toHaveBeenCalledWith('early', ['late', 'base']);
    });

    it('allows deselection, rebases the stack, and blocks a one-image group', () => {
        const onConfirm = vi.fn();
        const { container } = render(<StackGroup group={group('')} onConfirm={onConfirm} />);
        expect(screen.getByText('Workflow Detected')).toBeTruthy();
        const cards = [...container.querySelectorAll('img')].map(img => img.closest('.cursor-pointer') as HTMLElement);

        fireEvent.click(cards[0]);
        fireEvent.click(screen.getByRole('button', { name: 'Group (2)' }));
        expect(onConfirm).toHaveBeenCalledWith('early', ['late']);

        fireEvent.click(cards[1]);
        const disabled = screen.getByRole('button', { name: 'Group (1)' }) as HTMLButtonElement;
        expect(disabled.disabled).toBe(true);
        fireEvent.click(disabled);
        expect(onConfirm).toHaveBeenCalledOnce();

        fireEvent.click(cards[0]);
        expect(screen.getByRole('button', { name: 'Group (2)' })).toBeTruthy();
    });
});
