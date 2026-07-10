import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIImage, GeneratorTool } from '../../../../types';
import { PinnedShelf } from '../PinnedShelf';

interface CapturedGridItemProps extends Record<string, unknown> {
    image: AIImage;
    index: number;
    isSelected: boolean;
    isThumbnail: boolean;
    selectedIds: Set<string>;
    maskedKeywords: string[];
}

const gridItemCapture = vi.hoisted(() => ({ props: [] as CapturedGridItemProps[] }));
const settingsMock = vi.hoisted(() => ({ privacyEnabled: true }));

vi.mock('../GridItem', () => ({
    GridItem: (props: CapturedGridItemProps) => {
        gridItemCapture.props.push(props);
        return <div data-testid={`grid-item-${props.index}`} data-drag-source="true" />;
    },
}));

vi.mock('../../../../stores/settingsStore', () => ({
    useSettingsStore: (selector: (state: typeof settingsMock) => unknown) => selector(settingsMock),
}));

const createImage = (index: number, width = 200, height = 100): AIImage => ({
    id: `image-${index}`,
    url: `asset://image-${index}.png`,
    thumbnailUrl: `asset://thumb-${index}.png`,
    filename: `image-${index}.png`,
    timestamp: index,
    width,
    height,
    isFavorite: false,
    isPinned: true,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: 'Model',
        steps: 20,
        cfg: 7,
        sampler: 'Euler',
        positivePrompt: '',
        negativePrompt: '',
    },
});

const images = [
    createImage(0, 200, 100),
    createImage(1, 0, 100),
    createImage(2, 100, 0),
    createImage(3, 0, 0),
    createImage(4, 150, 100),
    createImage(5, 100, 100),
];

const callbacks = {
    onToggleCollapse: vi.fn(),
    setImages: vi.fn(),
    onImageClick: vi.fn(),
    onToggleSelection: vi.fn(),
    onTogglePin: vi.fn(),
    onToggleFavorite: vi.fn(),
    onContextMenu: vi.fn(),
    onRangeSelection: vi.fn(),
    onBackgroundClick: vi.fn(),
};

const createProps = (overrides: Partial<React.ComponentProps<typeof PinnedShelf>> = {}): React.ComponentProps<typeof PinnedShelf> => ({
    images,
    isCollapsed: true,
    selectedIds: new Set(['image-1']),
    maskedKeywords: ['secret'],
    thumbnailSize: 100,
    isActiveThumbnail: image => image.id === 'image-2',
    ...callbacks,
    ...overrides,
});

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
});

const getShelfContainer = (): HTMLDivElement => {
    const item = screen.getByTestId('grid-item-0').closest('[data-pinned-item-index]');
    const container = item?.parentElement?.parentElement;
    if (!(container instanceof HTMLDivElement)) throw new Error('Missing pinned shelf container');
    return container;
};

const setGeometry = (container: HTMLDivElement) => {
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 200, 200));
    const itemRects = [
        rect(10, 10, 20, 20),
        rect(100, 10, 20, 20),
        rect(-30, 10, 10, 20),
        rect(10, 100, 20, 20),
        rect(10, -30, 20, 10),
        rect(150, 150, 20, 20),
    ];
    container.querySelectorAll<HTMLElement>('[data-pinned-item-index]').forEach((node, index) => {
        vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(itemRects[index]);
    });
};

describe('PinnedShelf', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        gridItemCapture.props.length = 0;
        settingsMock.privacyEnabled = true;
    });

    it('renders nothing without pinned images', () => {
        const { container } = render(<PinnedShelf {...createProps({ images: [] })} />);
        expect(container.innerHTML).toBe('');
    });

    it('renders collapsed geometry, selection props, and the overflow fade', () => {
        const { container } = render(<PinnedShelf {...createProps()} />);
        const shelfContainer = getShelfContainer();

        expect(screen.getByText('Pinned')).toBeTruthy();
        expect(screen.getByText('6')).toBeTruthy();
        expect(container.querySelector('.lucide-chevron-down')).toBeTruthy();
        expect(shelfContainer.style.maxHeight).toBe('132px');
        expect(shelfContainer.className).toContain('overflow-y-hidden');
        expect(container.querySelector('.bg-gradient-to-t')).toBeTruthy();
        expect(gridItemCapture.props).toHaveLength(6);
        expect(gridItemCapture.props[1]).toMatchObject({ isSelected: true, isThumbnail: false });
        expect(gridItemCapture.props[2]).toMatchObject({ isSelected: false, isThumbnail: true });
        expect(gridItemCapture.props[0].maskedKeywords).toEqual(['secret']);

        const wrappers = container.querySelectorAll<HTMLElement>('[data-pinned-item-index]');
        expect(wrappers[0].style.width).toBe('200px');
        expect(wrappers[1].style.width).toBe('1px');
        expect(wrappers[2].style.width).toBe('10000px');
        expect(wrappers[3].style.width).toBe('100px');
    });

    it('expands the shelf and defaults optional thumbnail checks to false', () => {
        const fiveImages = images.slice(0, 5);
        const { container } = render(
            <PinnedShelf {...createProps({ images: fiveImages, isCollapsed: false, isActiveThumbnail: undefined })} />,
        );
        const shelfContainer = getShelfContainer();

        expect(container.querySelector('.lucide-chevron-up')).toBeTruthy();
        expect(shelfContainer.style.maxHeight).toBe('60vh');
        expect(shelfContainer.className).toContain('overflow-y-auto');
        expect(container.querySelector('.bg-gradient-to-t')).toBeNull();
        expect(gridItemCapture.props.every(item => item.isThumbnail === false)).toBe(true);

        fireEvent.click(screen.getByText('Pinned').parentElement?.parentElement as HTMLElement);
        expect(callbacks.onToggleCollapse).toHaveBeenCalledOnce();
    });

    it('ignores non-primary and draggable-item mouse presses', () => {
        render(<PinnedShelf {...createProps()} />);
        const shelfContainer = getShelfContainer();
        setGeometry(shelfContainer);

        fireEvent.mouseDown(shelfContainer, { button: 2, clientX: 10, clientY: 10 });
        fireEvent.mouseUp(window, { clientX: 10, clientY: 10 });
        fireEvent.mouseDown(screen.getByTestId('grid-item-0'), { button: 0, clientX: 10, clientY: 10 });
        fireEvent.mouseUp(window, { clientX: 10, clientY: 10 });

        expect(callbacks.onBackgroundClick).not.toHaveBeenCalled();
        expect(callbacks.onRangeSelection).not.toHaveBeenCalled();
    });

    it('treats a small pointer movement as a background click', () => {
        render(<PinnedShelf {...createProps()} />);
        const shelfContainer = getShelfContainer();
        setGeometry(shelfContainer);

        fireEvent.mouseDown(shelfContainer, { button: 0, clientX: 10, clientY: 10 });
        fireEvent.mouseMove(window, { clientX: 14, clientY: 15 });
        expect(document.querySelector('.border-sage-400')).toBeNull();
        fireEvent.mouseUp(window, { clientX: 14, clientY: 15 });

        expect(callbacks.onBackgroundClick).toHaveBeenCalledOnce();
        expect(callbacks.onRangeSelection).not.toHaveBeenCalled();
    });

    it('selects only overlapping items during an additive drag', () => {
        render(<PinnedShelf {...createProps()} />);
        const shelfContainer = getShelfContainer();
        setGeometry(shelfContainer);
        const firstItem = shelfContainer.querySelector<HTMLElement>('[data-pinned-item-index="0"]');
        firstItem?.setAttribute('data-pinned-item-index', '');

        fireEvent.mouseDown(shelfContainer, { button: 0, clientX: 0, clientY: 0 });
        fireEvent.mouseMove(window, { clientX: 50, clientY: 50 });
        fireEvent.mouseMove(window, { clientX: 45, clientY: 45 });
        const dragBox = document.querySelector<HTMLElement>('.border-sage-400');
        expect(dragBox).toBeTruthy();
        expect(dragBox?.style).toMatchObject({ left: '0px', top: '0px', width: '45px', height: '45px' });
        fireEvent.mouseUp(window, { clientX: 50, clientY: 50, shiftKey: true });

        expect(callbacks.onRangeSelection).toHaveBeenCalledWith([0], true);
        expect(document.querySelector('.border-sage-400')).toBeNull();
    });

    it('supports reverse-direction drags and the latest callback refs', () => {
        const firstRange = vi.fn();
        const latestRange = vi.fn();
        const firstBackground = vi.fn();
        const latestBackground = vi.fn();
        const { rerender } = render(
            <PinnedShelf {...createProps({ onRangeSelection: firstRange, onBackgroundClick: firstBackground })} />,
        );
        rerender(
            <PinnedShelf {...createProps({ onRangeSelection: latestRange, onBackgroundClick: latestBackground })} />,
        );
        const shelfContainer = getShelfContainer();
        setGeometry(shelfContainer);

        fireEvent.mouseDown(shelfContainer, { button: 0, clientX: 50, clientY: 50 });
        fireEvent.mouseMove(window, { clientX: 0, clientY: 0 });
        fireEvent.mouseUp(window, { clientX: 0, clientY: 0 });
        expect(latestRange).toHaveBeenCalledWith([0], false);
        expect(firstRange).not.toHaveBeenCalled();

        fireEvent.mouseDown(shelfContainer, { button: 0, clientX: 10, clientY: 10 });
        fireEvent.mouseUp(window, { clientX: 10, clientY: 10 });
        expect(latestBackground).toHaveBeenCalledOnce();
        expect(firstBackground).not.toHaveBeenCalled();
    });

    it('finishes a drag safely when no range callback is available', () => {
        render(<PinnedShelf {...createProps({ onRangeSelection: undefined, onBackgroundClick: undefined })} />);
        const shelfContainer = getShelfContainer();
        setGeometry(shelfContainer);

        fireEvent.mouseDown(shelfContainer, { button: 0, clientX: 0, clientY: 0 });
        fireEvent.mouseMove(window, { clientX: 0, clientY: 10 });
        fireEvent.mouseUp(window, { clientX: 0, clientY: 10 });

        expect(document.querySelector('.border-sage-400')).toBeNull();
        expect(callbacks.onRangeSelection).not.toHaveBeenCalled();
    });

    it('ignores pending pointer moves after the shelf unmounts', () => {
        const { unmount } = render(<PinnedShelf {...createProps()} />);
        const shelfContainer = getShelfContainer();
        setGeometry(shelfContainer);

        fireEvent.mouseDown(shelfContainer, { button: 0, clientX: 0, clientY: 0 });
        unmount();
        fireEvent.mouseMove(window, { clientX: 20, clientY: 20 });
        fireEvent.mouseUp(window, { clientX: 20, clientY: 20 });

        expect(callbacks.onRangeSelection).not.toHaveBeenCalled();
    });
});
