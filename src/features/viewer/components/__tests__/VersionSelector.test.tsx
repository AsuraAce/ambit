import { fireEvent, render, screen } from '../../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../../types';
import { VersionSelector } from '../VersionSelector';

const image = (id: string, width: number): AIImage => ({
    id, url: `${id}.png`, thumbnailUrl: `${id}-thumb.png`, filename: `${id}.png`, timestamp: 1,
    width, height: 100, isFavorite: false, isPinned: false,
    metadata: { tool: GeneratorTool.COMFYUI, model: '', seed: 1, steps: 1, cfg: 1, sampler: '', positivePrompt: '', negativePrompt: '' }
});

describe('VersionSelector', () => {
    it('does not render controls for a single version', () => {
        const { container } = render(<VersionSelector versions={[image('a', 100)]} activeVersionId="a" onVersionSelect={vi.fn()} showControls />);
        expect(container.firstChild).toBeNull();
    });

    it('marks active and upscaled versions and selects without bubbling', () => {
        const onVersionSelect = vi.fn();
        const parentClick = vi.fn();
        const { container, rerender } = render(<div onClick={parentClick}><VersionSelector versions={[image('a', 100), image('b', 200)]} activeVersionId="a" onVersionSelect={onVersionSelect} showControls /></div>);

        const buttons = screen.getAllByRole('button');
        expect(buttons[0].className).toContain('border-sage-500');
        expect(container.querySelector('.bg-amethyst-500')).toBeTruthy();
        fireEvent.click(buttons[1]);
        expect(onVersionSelect).toHaveBeenCalledWith('b');
        expect(parentClick).not.toHaveBeenCalled();

        rerender(<VersionSelector versions={[image('a', 100), image('b', 200)]} activeVersionId="b" onVersionSelect={onVersionSelect} showControls={false} />);
        expect(container.querySelector('.pointer-events-none')).toBeTruthy();
    });
});
