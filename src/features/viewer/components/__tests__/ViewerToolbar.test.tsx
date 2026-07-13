import { fireEvent, render, screen } from '../../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../../types';
import { ViewerToolbar } from '../ViewerToolbar';

const image = (overrides: Partial<AIImage> = {}): AIImage => ({
    id: 'a', url: 'a.png', thumbnailUrl: 'thumb.png', filename: 'C:/images/a.png', timestamp: 1, width: 100, height: 100,
    isFavorite: false, isPinned: false,
    metadata: { tool: GeneratorTool.COMFYUI, model: '', seed: 1, steps: 1, cfg: 1, sampler: '', positivePrompt: '', negativePrompt: '' }, ...overrides
});
const setup = (overrides: Partial<React.ComponentProps<typeof ViewerToolbar>> = {}) => {
    const props: React.ComponentProps<typeof ViewerToolbar> = {
        image: image(), versionsCount: 1, activeVersionIndex: 0, showControls: true, isTheaterMode: false, isSidebarOpen: true,
        onCopy: vi.fn(), onOpenExternal: vi.fn(), onToggleTheater: vi.fn(), onShare: vi.fn(), onToggleFavorite: vi.fn(),
        onTogglePin: vi.fn(), onDelete: vi.fn(), onToggleSidebar: vi.fn(), onClose: vi.fn(), ...overrides
    };
    const result = render(<ViewerToolbar {...props} />);
    return { ...result, props };
};

describe('ViewerToolbar', () => {
    it('routes every available toolbar action and shows version state', () => {
        const { props } = setup({ versionsCount: 3, activeVersionIndex: 1 });
        expect(screen.getByText('a.png')).toBeTruthy();
        expect(screen.getByText('Version 2 of 3')).toBeTruthy();
        const actions: Array<[string, () => void]> = [
            ['Copy Image to Clipboard', props.onCopy], ['Open in Default App', props.onOpenExternal], ['Enter Theater Mode (Z)', props.onToggleTheater],
            ['Share Image', props.onShare], ['Add to Favorites (F)', props.onToggleFavorite], ['Pin to Top (P)', props.onTogglePin!],
            ['Remove from Library', props.onDelete!], ['Hide Sidebar (I)', props.onToggleSidebar!], ['Close Viewer (Esc)', props.onClose]
        ];
        for (const [label, callback] of actions) {
            fireEvent.click(screen.getByRole('button', { name: label }));
            expect(callback).toHaveBeenCalledTimes(1);
        }
    });

    it('renders active favorite, pin, theater, hidden-sidebar, and hidden-control variants', () => {
        const { container } = setup({ image: image({ isFavorite: true, isPinned: true }), showControls: false, isTheaterMode: true, isSidebarOpen: false });
        expect(container.firstElementChild?.className).toContain('opacity-0');
        expect(screen.getByRole('button', { name: 'Remove from Favorites (F)' }).querySelector('.fill-red-500')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Unpin (P)' }).className).toContain('text-sage-400');
        expect(screen.getByRole('button', { name: 'Exit Theater Mode (Z)' }).className).toContain('text-sage-400');
        expect(screen.queryByRole('button', { name: 'Show Sidebar (I)' })).toBeNull();
        expect(screen.queryByText(/Version/)).toBeNull();
    });

    it('omits optional pin, delete, and sidebar controls and shows the closed sidebar action', () => {
        const first = setup({ isSidebarOpen: false, onTogglePin: undefined, onDelete: undefined });
        expect(screen.queryByRole('button', { name: /Pin to Top/ })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Remove from Library' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Show Sidebar (I)' })).toBeTruthy();
        first.unmount();

        setup({ onToggleSidebar: undefined });
        expect(screen.queryByRole('button', { name: /Sidebar/ })).toBeNull();
    });
});
