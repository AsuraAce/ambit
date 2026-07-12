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
            ['Copy Image to Clipboard', props.onCopy], ['Open in Default App', props.onOpenExternal], ['Theater Mode (Z)', props.onToggleTheater],
            ['Share', props.onShare], ['Favorite (F)', props.onToggleFavorite], ['Pin to top (P)', props.onTogglePin!],
            ['Remove from Library', props.onDelete!], ['Hide Sidebar (I)', props.onToggleSidebar!], ['Close (Esc)', props.onClose]
        ];
        for (const [title, callback] of actions) {
            fireEvent.click(screen.getByTitle(title));
            expect(callback).toHaveBeenCalledTimes(1);
        }
    });

    it('renders active favorite, pin, theater, hidden-sidebar, and hidden-control variants', () => {
        const { container } = setup({ image: image({ isFavorite: true, isPinned: true }), showControls: false, isTheaterMode: true, isSidebarOpen: false });
        expect(container.firstElementChild?.className).toContain('opacity-0');
        expect(screen.getByTitle('Favorite (F) - Remove').querySelector('.fill-red-500')).toBeTruthy();
        expect(screen.getByTitle('Unpin (P)').className).toContain('text-sage-400');
        expect(screen.getByTitle('Theater Mode (Z)').className).toContain('text-sage-400');
        expect(screen.queryByTitle('Show Sidebar (I)')).toBeNull();
        expect(screen.queryByText(/Version/)).toBeNull();
    });

    it('omits optional pin, delete, and sidebar controls and shows the closed sidebar action', () => {
        const first = setup({ isSidebarOpen: false, onTogglePin: undefined, onDelete: undefined });
        expect(screen.queryByTitle(/Pin to top/)).toBeNull();
        expect(screen.queryByTitle('Remove from Library')).toBeNull();
        expect(screen.getByTitle('Show Sidebar (I)')).toBeTruthy();
        first.unmount();

        setup({ onToggleSidebar: undefined });
        expect(screen.queryByTitle(/Sidebar/)).toBeNull();
    });
});
