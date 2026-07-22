import * as React from 'react';
import { fireEvent, render, screen } from '../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../types';
import type { DuplicateGroup } from '../../../hooks/useDuplicateFinder';
import { DuplicateFinder } from './DuplicateFinder';

const mocks = vi.hoisted(() => ({
    groups: [] as DuplicateGroup[],
    totalRedundantCount: 0,
    isResolving: false,
    handleResolve: vi.fn().mockResolvedValue(undefined),
    handleBulkResolve: vi.fn().mockResolvedValue(undefined),
    masked: false,
}));

vi.mock('../../../hooks/useDuplicateFinder', () => ({
    useDuplicateFinder: () => ({
        groups: mocks.groups,
        totalRedundantCount: mocks.totalRedundantCount,
        isResolving: mocks.isResolving,
        handleResolve: mocks.handleResolve,
        handleBulkResolve: mocks.handleBulkResolve,
    }),
}));
vi.mock('../../../utils/maskingUtils', () => ({ isImageMasked: () => mocks.masked }));
vi.mock('../../../stores/settingsStore', () => ({
    useSettingsStore: (selector: (state: { privacyEnabled: boolean }) => unknown) => selector({ privacyEnabled: true }),
}));
vi.mock('../../library/components/VirtualGrid', () => ({
    VirtualGrid: (props: {
        items: DuplicateGroup[];
        renderItem: (item: DuplicateGroup, style: React.CSSProperties) => React.ReactNode;
        getItemRatio: () => number;
        onRangeSelection?: (indexes: number[], additive: boolean) => void;
        onBackgroundClick?: () => void;
    }) => (
        <div data-testid="grid">
            <span>ratio:{props.getItemRatio()}</span>
            <button onClick={() => props.onRangeSelection?.([1], true)}>range</button>
            <button onClick={props.onBackgroundClick}>background</button>
            {props.items.map(item => props.renderItem(item, { height: 300 }))}
        </div>
    ),
}));

const image = (id: string, timestamp: number): AIImage => ({
    id,
    url: `${id}.png`,
    thumbnailUrl: `${id}-thumb.png`,
    filename: `${id}.png`,
    timestamp,
    width: 100,
    height: 200,
    fileHash: 'hash',
    isFavorite: false,
    isPinned: false,
    metadata: {
        tool: GeneratorTool.COMFYUI,
        model: '',
        seed: 1,
        steps: 1,
        cfg: 1,
        sampler: '',
        positivePrompt: '',
        negativePrompt: '',
    },
});

const exact = (count = 2): DuplicateGroup => {
    const images = Array.from({ length: count }, (_, index) => image(`exact-${index}`, index + 1));
    return { id: 'exact-group', images, latestModifiedId: images.at(-1)?.id ?? '' };
};

const baseProps = () => ({
    images: [] as AIImage[],
    onResolve: vi.fn().mockResolvedValue(undefined),
    maskedKeywords: ['private'],
    scrollContainerRef: { current: null } as React.RefObject<HTMLDivElement | null>,
});

describe('DuplicateFinder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.groups = [];
        mocks.totalRedundantCount = 0;
        mocks.isResolving = false;
        mocks.masked = false;
    });

    it('renders only the global exact scan entry point', () => {
        const onRefresh = vi.fn();
        render(<DuplicateFinder {...baseProps()} onRefresh={onRefresh} />);

        expect(screen.getByText('Library is Clean')).toBeTruthy();
        expect(screen.getByText(/No exact SHA-256 duplicate groups/)).toBeTruthy();
        expect(screen.queryByText('Current Filter')).toBeNull();
        expect(screen.queryByText(/likely/i)).toBeNull();
        fireEvent.click(screen.getByText('Run Global Scan'));
        expect(onRefresh).toHaveBeenCalledWith();
    });

    it('distinguishes an incomplete scan from a clean library', () => {
        const scanResult = { scanned: 4, updated: 2, missing: 0, errors: 1, remaining: 3, wasCancelled: true };
        render(<DuplicateFinder {...baseProps()} scanResult={scanResult} />);

        expect(screen.getByText('Scan Incomplete')).toBeTruthy();
        expect(screen.getByText(/1 scan error/)).toBeTruthy();
        expect(screen.queryByText('Library is Clean')).toBeNull();
    });

    it('shows indeterminate and measured scan progress with optional cancellation', () => {
        const onCancelScan = vi.fn();
        const props = baseProps();
        const { container, rerender } = render(<DuplicateFinder {...props} isScanning onCancelScan={onCancelScan} />);
        expect(screen.getByText('Preparing exact duplicate detection...')).toBeTruthy();
        expect(screen.getByText('Scanning candidates')).toBeTruthy();
        expect(container.querySelector('[style="width: 12%;"]')).toBeTruthy();
        fireEvent.click(screen.getByText('Cancel'));
        expect(onCancelScan).toHaveBeenCalledTimes(1);

        rerender(<DuplicateFinder {...props} isScanning scanProgress={{ current: 3, total: 4, message: 'Hashing' }} />);
        expect(screen.getByText('Hashing')).toBeTruthy();
        expect(screen.getByText('3 / 4')).toBeTruthy();
        expect(screen.getByText('75%')).toBeTruthy();
    });

    it('renders exact groups and routes global refresh, bulk, and grid actions', () => {
        mocks.groups = [exact(3)];
        mocks.totalRedundantCount = 2;
        const onRefresh = vi.fn();
        const onRangeSelection = vi.fn();
        const onBackgroundClick = vi.fn();
        render(<DuplicateFinder
            {...baseProps()}
            onRefresh={onRefresh}
            onRangeSelection={onRangeSelection}
            onBackgroundClick={onBackgroundClick}
        />);

        expect(screen.getByText(/Found 1 exact groups/)).toBeTruthy();
        expect(screen.getByText('Global Scan')).toBeTruthy();
        expect(screen.getByText('Exact Duplicate Group')).toBeTruthy();
        expect(screen.getByText('3 copies')).toBeTruthy();
        expect(screen.getByText('Latest Modified')).toBeTruthy();
        expect(screen.getByText(/Files stay on disk/)).toBeTruthy();

        fireEvent.click(screen.getByTitle('Rescan entire library'));
        fireEvent.click(screen.getByText('Keep Latest Modified'));
        fireEvent.click(screen.getByText('Keep Earliest Modified'));
        fireEvent.click(screen.getByText('range'));
        fireEvent.click(screen.getByText('background'));

        expect(onRefresh).toHaveBeenCalledWith();
        expect(mocks.handleBulkResolve).toHaveBeenNthCalledWith(1, 'latestModified');
        expect(mocks.handleBulkResolve).toHaveBeenNthCalledWith(2, 'earliestModified');
        expect(onRangeSelection).toHaveBeenCalledWith([1], true);
        expect(onBackgroundClick).toHaveBeenCalledTimes(1);
    });

    it('routes keep, viewer, and comparison actions through the exact group', () => {
        mocks.groups = [exact(3)];
        mocks.totalRedundantCount = 2;
        const onViewImage = vi.fn();
        const onCompareImages = vi.fn();
        render(<DuplicateFinder {...baseProps()} onViewImage={onViewImage} onCompareImages={onCompareImages} />);

        fireEvent.click(screen.getAllByRole('button', { name: 'Open in Viewer' })[0]);
        fireEvent.click(screen.getAllByRole('button', { name: 'Compare with Another Copy' })[0]);
        fireEvent.click(screen.getAllByText('Keep Only This')[1]);

        expect(onViewImage).toHaveBeenCalledWith('exact-0');
        expect(onCompareImages).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'exact-2' }),
            expect.objectContaining({ id: 'exact-0' })
        );
        expect(mocks.handleResolve).toHaveBeenCalledWith('exact-1', ['exact-0', 'exact-1', 'exact-2']);
    });

    it('contains rejected resolution actions after the persistence layer reports the failure', async () => {
        mocks.groups = [exact()];
        mocks.totalRedundantCount = 1;
        mocks.handleResolve.mockRejectedValueOnce(new Error('stale group'));
        mocks.handleBulkResolve.mockRejectedValueOnce(new Error('stale batch'));
        render(<DuplicateFinder {...baseProps()} />);

        fireEvent.click(screen.getAllByText('Keep Only This')[0]);
        fireEvent.click(screen.getByText('Keep Latest Modified'));
        await Promise.resolve();

        expect(mocks.handleResolve).toHaveBeenCalledTimes(1);
        expect(mocks.handleBulkResolve).toHaveBeenCalledTimes(1);
    });

    it('protects masked previews and resets reveal on mouse leave', () => {
        mocks.groups = [exact()];
        mocks.totalRedundantCount = 1;
        mocks.masked = true;
        const { container } = render(<DuplicateFinder {...baseProps()} />);
        expect(screen.getAllByText('Reveal')).toHaveLength(2);
        const firstItem = container.querySelector('[title="exact-0.png"]')?.closest('.group') as HTMLElement;
        fireEvent.click(screen.getAllByText('Reveal')[0]);
        expect(screen.getAllByText('Reveal')).toHaveLength(1);
        fireEvent.mouseLeave(firstItem);
        expect(screen.getAllByText('Reveal')).toHaveLength(2);
    });
});
