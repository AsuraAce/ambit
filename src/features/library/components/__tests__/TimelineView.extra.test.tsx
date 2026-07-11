import * as React from 'react';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../../types';
import { TimelineView } from '../TimelineView';

const mocks = vi.hoisted(() => ({
    groups: [] as Array<{ id: string; images: AIImage[] }>,
    visibleItems: [] as Array<Record<string, unknown>>,
    headers: [] as Array<Record<string, unknown>>,
    totalHeight: 400,
    activeHeaderData: { date: 'Active Day', count: 2 } as { date: string; count: number } | null,
    dragBox: null as { x: number; y: number; w: number; h: number } | null,
    handleMouseDown: vi.fn(),
    handleScroll: vi.fn(),
    setActiveHeaderData: vi.fn(),
    layoutArgs: null as Record<string, unknown> | null,
    selectionArgs: null as Record<string, unknown> | null,
    scrollArgs: null as Record<string, unknown> | null,
    imageCardProps: [] as Array<Record<string, unknown>>,
    masked: false,
    disconnect: vi.fn(),
    resizeCallback: null as ResizeObserverCallback | null
}));

vi.mock('../../../../hooks/useTimeline', () => ({ useTimeline: () => ({ groups: mocks.groups }) }));
vi.mock('../../hooks/useTimelineLayout', () => ({
    useTimelineLayout: (args: Record<string, unknown>) => {
        mocks.layoutArgs = args;
        return { totalHeight: mocks.totalHeight, headers: mocks.headers, visibleItems: mocks.visibleItems, activeHeaderData: mocks.activeHeaderData, setActiveHeaderData: mocks.setActiveHeaderData, activeHeaderIdRef: { current: null } };
    }
}));
vi.mock('../../hooks/useTimelineSelection', () => ({
    useTimelineSelection: (args: Record<string, unknown>) => { mocks.selectionArgs = args; return { dragBox: mocks.dragBox, handleMouseDown: mocks.handleMouseDown }; }
}));
vi.mock('../../hooks/useTimelineScroll', () => ({
    useTimelineScroll: (args: Record<string, unknown>) => { mocks.scrollArgs = args; return mocks.handleScroll; }
}));
vi.mock('../../../../utils/maskingUtils', () => ({ isImageMasked: () => mocks.masked }));
vi.mock('../../../../stores/settingsStore', () => ({ useSettingsStore: (selector: (state: { privacyEnabled: boolean }) => unknown) => selector({ privacyEnabled: true }) }));
vi.mock('../ImageCard', () => ({
    ImageCard: (props: Record<string, unknown>) => {
        mocks.imageCardProps.push(props);
        const image = props.image as AIImage;
        return <div data-testid={`card-${image.id}`}><button onClick={props.onClick as React.MouseEventHandler}>open-{image.id}</button><button onClick={props.onToggleSelection as React.MouseEventHandler}>select-{image.id}</button><button onClick={props.onToggleFavorite as React.MouseEventHandler}>favorite-{image.id}</button><button onClick={props.onTogglePin as React.MouseEventHandler | undefined}>pin-{image.id}</button><button onContextMenu={props.onContextMenu as React.MouseEventHandler}>menu-{image.id}</button></div>;
    }
}));

const image = (id: string): AIImage => ({
    id, url: `${id}.png`, thumbnailUrl: `${id}-thumb.png`, filename: `${id}.png`, timestamp: 1, width: 100, height: 100,
    isFavorite: false, isPinned: false, metadata: { tool: GeneratorTool.COMFYUI, model: '', seed: 1, steps: 1, cfg: 1, sampler: '', positivePrompt: '', negativePrompt: '' }
});
const setup = (images: AIImage[], overrides: Partial<React.ComponentProps<typeof TimelineView>> = {}) => {
    const props: React.ComponentProps<typeof TimelineView> = {
        images, selectedIds: new Set<string>(), sortOption: 'date_desc', onImageClick: vi.fn(), onSelectionToggle: vi.fn(),
        onToggleFavorite: vi.fn(), onTogglePin: vi.fn(), onContextMenu: vi.fn(), maskedKeywords: [], ...overrides
    };
    const result = render(<TimelineView {...props} />);
    return { ...result, props };
};

describe('TimelineView component routing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.groups = [];
        mocks.visibleItems = [];
        mocks.headers = [];
        mocks.totalHeight = 400;
        mocks.activeHeaderData = { date: 'Active Day', count: 2 };
        mocks.dragBox = null;
        mocks.masked = false;
        mocks.imageCardProps.length = 0;
        mocks.resizeCallback = null;
        vi.stubGlobal('ResizeObserver', class ResizeObserver {
            private readonly callback: ResizeObserverCallback;
            constructor(callback: ResizeObserverCallback) { this.callback = callback; mocks.resizeCallback = callback; }
            observe(target: Element) { this.callback([{ target, contentRect: { width: 640 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
            unobserve() { return undefined; }
            disconnect() { mocks.disconnect(); }
        });
    });

    it('renders headers, rows, loading state, and routes every card action', () => {
        const a = image('a');
        const b = image('b');
        mocks.groups = [{ id: 'day', images: [b, a] }];
        mocks.visibleItems = [
            { type: 'header', id: 'day', date: 'Today', count: 2, y: 0, height: 50 },
            { type: 'row', y: 45, height: 1, items: [] },
            { type: 'row', y: 50, height: 100, items: [
                { image: b, x: 0, width: 100, height: 100, globalIndex: 0 },
                { image: a, x: 110, width: 100, height: 100, globalIndex: 1 }
            ] }
        ];
        mocks.masked = true;
        const onRangeSelection = vi.fn();
        const { container, props } = setup([a, b], { selectedIds: new Set(['b']), isLoadingMore: true, onRangeSelection });
        expect(screen.getByText('Today')).toBeTruthy();
        expect(screen.getByText('Active Day')).toBeTruthy();
        expect(screen.getByText('Loading older images')).toBeTruthy();
        expect(mocks.imageCardProps[0]).toMatchObject({ isSelected: true, isMasked: true });
        fireEvent.click(screen.getByText('open-b'));
        fireEvent.click(screen.getByText('select-b'));
        fireEvent.click(screen.getByText('favorite-b'));
        fireEvent.click(screen.getByText('pin-b'));
        fireEvent.contextMenu(screen.getByText('menu-b'));
        expect(props.onImageClick).toHaveBeenCalledWith(expect.anything(), 'b', 1);
        expect(props.onSelectionToggle).toHaveBeenCalledWith(expect.anything(), 'b');
        expect(props.onToggleFavorite).toHaveBeenCalledWith(expect.anything(), 'b');
        expect(props.onTogglePin).toHaveBeenCalledWith(expect.anything(), 'b');
        expect(props.onContextMenu).toHaveBeenCalledWith(expect.anything(), 'b');
        fireEvent.scroll(container.querySelector('.overflow-y-auto') as HTMLElement);
        fireEvent.mouseDown(container.querySelector('.overflow-y-auto') as HTMLElement);
        expect(mocks.handleScroll).toHaveBeenCalled();
        expect(mocks.handleMouseDown).toHaveBeenCalled();

        const selection = (mocks.selectionArgs?.onRangeSelection as (indexes: number[], additive: boolean) => void);
        selection([0, 1, 4], true);
        expect(onRangeSelection).toHaveBeenCalledWith([1, 0], true);
    });

    it('builds drag payloads from selection or the current image and tolerates data-transfer failures', () => {
        const a = image('a');
        mocks.groups = [{ id: 'day', images: [a] }];
        mocks.visibleItems = [{ type: 'row', y: 0, height: 100, items: [{ image: a, x: 0, width: 100, height: 100, globalIndex: 0 }] }];
        setup([a], { selectedIds: new Set(['selected-1', 'selected-2']) });
        const drag = mocks.imageCardProps[0].onDragStart as (event: React.DragEvent) => void;
        const dataTransfer = { effectAllowed: '', setData: vi.fn() };
        drag({ dataTransfer } as unknown as React.DragEvent);
        expect(dataTransfer.effectAllowed).toBe('copyMove');
        expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-ambit-image-ids', JSON.stringify(['selected-1', 'selected-2']));

        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        drag({ dataTransfer: { set effectAllowed(_value: string) { throw new Error('blocked'); } } } as unknown as React.DragEvent);
        expect(error).toHaveBeenCalled();

        mocks.imageCardProps.length = 0;
        setup([a], { selectedIds: new Set() });
        const singleDrag = mocks.imageCardProps.at(-1)?.onDragStart as (event: React.DragEvent) => void;
        const singleTransfer = { effectAllowed: '', setData: vi.fn() };
        singleDrag({ dataTransfer: singleTransfer } as unknown as React.DragEvent);
        expect(singleTransfer.setData).toHaveBeenCalledWith('application/x-ambit-image-ids', JSON.stringify(['a']));
    });

    it('falls back for missing source ids and out-of-range layout indexes', () => {
        const source = image('source');
        const ghost = image('ghost');
        mocks.groups = [{ id: 'day', images: [ghost, source] }];
        mocks.visibleItems = [{ type: 'row', y: 0, height: 100, items: [{ image: source, x: 0, width: 100, height: 100, globalIndex: 99 }] }];
        const { props } = setup([source]);
        fireEvent.click(screen.getByText('open-source'));
        expect(props.onImageClick).toHaveBeenCalledWith(expect.anything(), 'source', 99);
    });

    it('renders empty and drag-box states and handles optional callbacks', () => {
        mocks.dragBox = { x: 1, y: 2, w: 3, h: 4 };
        const { container } = setup([], { onTogglePin: undefined, onRangeSelection: undefined, onBackgroundClick: vi.fn(), hasMoreImages: true, onLoadMore: vi.fn() });
        expect(screen.getByText('No images found in this timeframe.')).toBeTruthy();
        const box = container.querySelector('.border-sage-400') as HTMLElement;
        expect(box.style.width).toBe('3px');
        expect(mocks.scrollArgs).toMatchObject({ hasMoreImages: true, isLoadingMore: false });
        const selection = mocks.selectionArgs?.onRangeSelection as (indexes: number[], additive: boolean) => void;
        selection([0], false);
    });

    it('ignores empty resize entries and disconnects its observer', () => {
        const { unmount } = setup([]);
        mocks.resizeCallback?.([], {} as ResizeObserver);
        expect(mocks.layoutArgs?.width).toBe(640);
        unmount();
        expect(mocks.disconnect).toHaveBeenCalledTimes(1);
    });
});
