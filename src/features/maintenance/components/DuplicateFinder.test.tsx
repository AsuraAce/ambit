import * as React from 'react';
import { fireEvent, render, screen } from '../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../types';
import type { DuplicateGroup } from '../../../hooks/useDuplicateFinder';
import { DuplicateFinder } from './DuplicateFinder';

const mocks = vi.hoisted(() => ({
    groups: [] as DuplicateGroup[],
    totalRedundantCount: 0,
    exactRedundantCount: 0,
    handleResolve: vi.fn(),
    handleBulkResolve: vi.fn(),
    masked: false,
    gridProps: null as Record<string, unknown> | null
}));

vi.mock('../../../hooks/useDuplicateFinder', () => ({
    useDuplicateFinder: () => ({
        groups: mocks.groups,
        totalRedundantCount: mocks.totalRedundantCount,
        exactRedundantCount: mocks.exactRedundantCount,
        handleResolve: mocks.handleResolve,
        handleBulkResolve: mocks.handleBulkResolve
    })
}));
vi.mock('../../../utils/maskingUtils', () => ({ isImageMasked: () => mocks.masked }));
vi.mock('../../../stores/settingsStore', () => ({ useSettingsStore: (selector: (state: { privacyEnabled: boolean }) => unknown) => selector({ privacyEnabled: true }) }));
vi.mock('../../library/components/VirtualGrid', () => ({
    VirtualGrid: (props: {
        items: DuplicateGroup[];
        renderItem: (item: DuplicateGroup, style: React.CSSProperties) => React.ReactNode;
        getItemRatio: () => number;
        onRangeSelection?: (indexes: number[], additive: boolean) => void;
        onBackgroundClick?: () => void;
    }) => {
        mocks.gridProps = props as unknown as Record<string, unknown>;
        return <div data-testid="grid"><span>ratio:{props.getItemRatio()}</span><button onClick={() => props.onRangeSelection?.([1], true)}>range</button><button onClick={props.onBackgroundClick}>background</button>{props.items.map(item => props.renderItem(item, { height: 300 }))}</div>;
    }
}));

const image = (id: string, timestamp: number): AIImage => ({
    id, url: `${id}.png`, thumbnailUrl: `${id}-thumb.png`, filename: `${id}.png`, timestamp,
    width: 100, height: 200, fileHash: 'hash', isFavorite: false, isPinned: false,
    metadata: { tool: GeneratorTool.COMFYUI, model: '', seed: 1, steps: 1, cfg: 1, sampler: '', positivePrompt: '', negativePrompt: '' }
});
const exact = (count = 2): DuplicateGroup => {
    const images = Array.from({ length: count }, (_, index) => image(`exact-${index}`, index + 1));
    return { id: 'exact-group', kind: 'exact', images, newestId: images.at(-1)?.id ?? '' };
};
const likely = (): DuplicateGroup => ({ id: 'likely-group', kind: 'likely', images: [image('likely-a', 1), image('likely-b', 2)], newestId: 'likely-b' });
const baseProps = () => ({
    images: [] as AIImage[], onResolve: vi.fn(), maskedKeywords: ['private'],
    scrollContainerRef: { current: null } as React.RefObject<HTMLDivElement | null>
});

describe('DuplicateFinder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.groups = [];
        mocks.totalRedundantCount = 0;
        mocks.exactRedundantCount = 0;
        mocks.masked = false;
        mocks.gridProps = null;
    });

    it('renders clean global and filtered states and routes every scan scope', () => {
        const onRefresh = vi.fn();
        const props = baseProps();
        const { rerender } = render(<DuplicateFinder {...props} onRefresh={onRefresh} />);
        expect(screen.getByText('Library is Clean')).toBeTruthy();
        expect(screen.getByText(/entire library/)).toBeTruthy();
        fireEvent.click(screen.getByText('Run Global Scan'));
        fireEvent.click(screen.getByText('Entire Library'));
        fireEvent.click(screen.getByText('Current Filter'));
        expect(onRefresh.mock.calls).toEqual([['global'], ['global'], ['filtered']]);

        rerender(<DuplicateFinder {...props} scope="filtered" onRefresh={onRefresh} />);
        expect(screen.getByText(/current filter results/)).toBeTruthy();
        fireEvent.click(screen.getByText('Run Filtered Scan'));
        expect(onRefresh).toHaveBeenLastCalledWith('filtered');

        rerender(<DuplicateFinder {...props} scope="filtered" />);
        expect(screen.queryByText('Run Filtered Scan')).toBeNull();
    });

    it('shows indeterminate and measured scan progress with optional cancellation', () => {
        const onCancelScan = vi.fn();
        const props = baseProps();
        const { container, rerender } = render(<DuplicateFinder {...props} isScanning onCancelScan={onCancelScan} />);
        expect(screen.getByText('Scanning for Duplicates')).toBeTruthy();
        expect(screen.getByText('Preparing exact duplicate detection...')).toBeTruthy();
        expect(screen.getByText('Scanning candidates')).toBeTruthy();
        expect(container.querySelector('[style="width: 12%;"]')).toBeTruthy();
        fireEvent.click(screen.getByText('Cancel'));
        expect(onCancelScan).toHaveBeenCalledTimes(1);

        rerender(<DuplicateFinder {...props} scope="filtered" isScanning scanProgress={{ current: 3, total: 4, message: 'Hashing' }} />);
        expect(screen.getByText('Hashing')).toBeTruthy();
        expect(screen.getByText('3 / 4')).toBeTruthy();
        expect(screen.getByText('75%')).toBeTruthy();
        expect(screen.getByText(/current filter results/)).toBeTruthy();
        expect(screen.queryByText('Cancel')).toBeNull();
    });

    it('renders exact and likely groups and routes grid, refresh, and bulk actions', () => {
        mocks.groups = [exact(3), likely()];
        mocks.totalRedundantCount = 3;
        mocks.exactRedundantCount = 2;
        const onRefresh = vi.fn();
        const onRangeSelection = vi.fn();
        const onBackgroundClick = vi.fn();
        const { rerender } = render(<DuplicateFinder {...baseProps()} scope="filtered" onRefresh={onRefresh} onRangeSelection={onRangeSelection} onBackgroundClick={onBackgroundClick} />);

        expect(screen.getByText(/Found 1 exact and 1 likely groups/)).toBeTruthy();
        expect(screen.getByText('Filtered Scan')).toBeTruthy();
        expect(screen.getByText('Exact Duplicate Group')).toBeTruthy();
        expect(screen.getByText('Likely Duplicate Group')).toBeTruthy();
        expect(screen.getByText('3 copies')).toBeTruthy();
        expect(screen.getByText('ratio:1.5')).toBeTruthy();
        expect(screen.getAllByText('Newest')).toHaveLength(2);

        fireEvent.click(screen.getByText('Global'));
        fireEvent.click(screen.getByText('Filtered'));
        fireEvent.click(screen.getByTitle('Rescan current filter'));
        expect(onRefresh.mock.calls).toEqual([['global'], ['filtered'], ['filtered']]);
        fireEvent.click(screen.getByText('Keep Newest'));
        fireEvent.click(screen.getByText('Keep Oldest'));
        expect(mocks.handleBulkResolve).toHaveBeenNthCalledWith(1, 'newest');
        expect(mocks.handleBulkResolve).toHaveBeenNthCalledWith(2, 'oldest');
        fireEvent.click(screen.getByText('range'));
        fireEvent.click(screen.getByText('background'));
        expect(onRangeSelection).toHaveBeenCalledWith([1], true);
        expect(onBackgroundClick).toHaveBeenCalledTimes(1);

        rerender(<DuplicateFinder {...baseProps()} scope="global" isScanning scanProgress={{ current: 1, total: 2, message: 'Continuing' }} onRefresh={onRefresh} />);
        expect(screen.getByText('Duplicate Scan Running')).toBeTruthy();
        expect(screen.getByTitle('Rescan entire library').querySelector('.animate-spin')).toBeTruthy();
    });

    it('routes keep, view, and comparison actions with newest and fallback peers', () => {
        mocks.groups = [exact(3)];
        mocks.totalRedundantCount = 2;
        mocks.exactRedundantCount = 2;
        const onViewImage = vi.fn();
        const onCompareImages = vi.fn();
        render(<DuplicateFinder {...baseProps()} onViewImage={onViewImage} onCompareImages={onCompareImages} />);

        fireEvent.click(screen.getAllByRole('button', { name: 'Open in Viewer' })[0]);
        expect(onViewImage).toHaveBeenCalledWith('exact-0');
        fireEvent.click(screen.getAllByRole('button', { name: 'Compare with Another Copy' })[0]);
        expect(onCompareImages).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'exact-2' }), expect.objectContaining({ id: 'exact-0' }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Compare with Another Copy' })[2]);
        expect(onCompareImages).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'exact-0' }), expect.objectContaining({ id: 'exact-2' }));
        fireEvent.click(screen.getAllByText('Keep Only This')[1]);
        expect(mocks.handleResolve).toHaveBeenCalledWith('exact-group', 'exact-1', ['exact-0', 'exact-1', 'exact-2']);
    });

    it('protects masked previews, resets reveal on leave, and disables unavailable comparison', () => {
        mocks.groups = [likely()];
        mocks.totalRedundantCount = 1;
        mocks.masked = true;
        const { container } = render(<DuplicateFinder {...baseProps()} />);
        expect(screen.getAllByText('Reveal')).toHaveLength(2);
        expect(screen.queryByRole('button', { name: 'Open in Viewer' })).toBeNull();
        const firstItem = container.querySelector('[title="likely-a.png"]')?.closest('.group') as HTMLElement;
        fireEvent.mouseLeave(firstItem);
        expect(screen.getAllByText('Reveal')).toHaveLength(2);
        fireEvent.click(screen.getAllByText('Reveal')[0]);
        expect(screen.getAllByText('Reveal')).toHaveLength(1);
        fireEvent.mouseLeave(firstItem);
        expect(screen.getAllByText('Reveal')).toHaveLength(2);

        mocks.masked = false;
        const { rerender } = render(<DuplicateFinder {...baseProps()} />);
        rerender(<DuplicateFinder {...baseProps()} />);
        for (const button of screen.getAllByRole('button', { name: 'Compare with Another Copy' })) expect((button as HTMLButtonElement).disabled).toBe(true);
    });
});
