import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GridItem } from '../GridItem';
import { AIImage, GeneratorTool } from '../../../../types';

interface CapturedImageCardProps {
    image: AIImage;
    isSelected: boolean;
    isMasked: boolean;
    isThumbnail: boolean;
    onDragStart: (event: React.DragEvent) => void;
    onClick: (event: React.MouseEvent) => void;
    onToggleSelection: (event: React.MouseEvent) => void;
    onToggleFavorite: (event: React.MouseEvent) => void;
    onTogglePin: (event: React.MouseEvent) => void;
    onContextMenu: (event: React.MouseEvent) => void;
    onImageError: () => void;
}

const imageCardCapture = vi.hoisted(() => ({ current: null as CapturedImageCardProps | null }));
const verifyImagePathsMock = vi.hoisted(() => vi.fn());

vi.mock('../ImageCard', () => ({
    ImageCard: (props: CapturedImageCardProps) => {
        imageCardCapture.current = props;
        return <div data-testid="image-card" />;
    }
}));

vi.mock('../../../../bindings', () => ({
    commands: {
        verifyImagePaths: verifyImagePathsMock
    }
}));

const selectedIds = new Set<string>();
const maskedKeywords: string[] = [];

const image: AIImage = {
    id: 'image-1',
    url: 'file:///image-1.png',
    thumbnailUrl: 'file:///image-1-thumb.png',
    filename: 'image-1.png',
    timestamp: 1,
    width: 120,
    height: 90,
    isFavorite: false,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: 'Unknown',
        seed: 1,
        steps: 20,
        cfg: 7,
        sampler: 'Euler',
        positivePrompt: '',
        negativePrompt: ''
    }
};

const layoutPos = { x: 0, y: 0, width: 120, height: 90 };

const baseStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 120,
    height: 90,
    transform: 'translate3d(0px, 0px, 0)'
};

const createProps = (style: React.CSSProperties): React.ComponentProps<typeof GridItem> => ({
    image,
    style,
    index: 0,
    isSelected: false,
    selectedIds,
    maskedKeywords,
    setImages: () => undefined,
    onClick: () => undefined,
    onToggleSelection: () => undefined,
    onTogglePin: () => undefined,
    onToggleFavorite: () => undefined,
    onContextMenu: () => undefined,
    layoutPos
});

const getGridItemRoot = () => {
    const root = screen.getByTestId('image-card').parentElement?.parentElement;

    if (!(root instanceof HTMLElement)) {
        throw new Error('Expected GridItem root element');
    }

    return root;
};

describe('GridItem memoized motion styles', () => {
    beforeEach(() => {
        imageCardCapture.current = null;
        verifyImagePathsMock.mockReset();
    });

    afterEach(() => {
        cleanup();
    });

    it('rerenders when temporary motion style fields are added and removed', () => {
        const { rerender } = render(<GridItem {...createProps(baseStyle)} />);

        expect(getGridItemRoot().style.transition).toBe('');
        expect(getGridItemRoot().style.willChange).toBe('');

        rerender(
            <GridItem
                {...createProps({
                    ...baseStyle,
                    transition: 'transform 260ms cubic-bezier(0.2, 1.12, 0.22, 1), width 220ms cubic-bezier(0.16, 1, 0.3, 1), height 220ms cubic-bezier(0.16, 1, 0.3, 1)',
                    willChange: 'transform',
                    opacity: 0.98
                })}
            />
        );

        expect(getGridItemRoot().style.transition).toContain('transform 260ms');
        expect(getGridItemRoot().style.willChange).toBe('transform');
        expect(getGridItemRoot().style.opacity).toBe('0.98');

        rerender(<GridItem {...createProps(baseStyle)} />);

        expect(getGridItemRoot().style.transition).toBe('');
        expect(getGridItemRoot().style.willChange).toBe('');
        expect(getGridItemRoot().style.opacity).toBe('');
    });

    it('forwards card interactions with the image identity', () => {
        const onClick = vi.fn();
        const onToggleSelection = vi.fn();
        const onToggleFavorite = vi.fn();
        const onTogglePin = vi.fn();
        const onContextMenu = vi.fn();
        render(<GridItem {...createProps(baseStyle)} {...{
            onClick,
            onToggleSelection,
            onToggleFavorite,
            onTogglePin,
            onContextMenu,
            isSelected: true,
            isThumbnail: true,
        }} />);
        const card = imageCardCapture.current!;
        const event = {
            stopPropagation: vi.fn(),
            preventDefault: vi.fn(),
        } as unknown as React.MouseEvent;

        card.onClick(event);
        card.onToggleSelection(event);
        card.onToggleFavorite(event);
        card.onTogglePin(event);
        card.onContextMenu(event);

        expect(card.isSelected).toBe(true);
        expect(card.isThumbnail).toBe(true);
        expect(onClick).toHaveBeenCalledWith(event, image.id, 0);
        expect(onToggleSelection).toHaveBeenCalledWith(event, image.id);
        expect(onToggleFavorite).toHaveBeenCalledWith(event, image.id);
        expect(onTogglePin).toHaveBeenCalledWith(event, image.id);
        expect(onContextMenu).toHaveBeenCalledWith(event, image.id);
        expect(event.stopPropagation).toHaveBeenCalledTimes(2);
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(getGridItemRoot().style.zIndex).toBe('10');
    });

    it('uses selected image ids for drag data and falls back to the current image', () => {
        const setData = vi.fn();
        const dataTransfer = { effectAllowed: 'none', setData };
        const selected = new Set(['image-1', 'image-2']);
        const view = render(<GridItem {...createProps(baseStyle)} selectedIds={selected} />);

        imageCardCapture.current!.onDragStart({ dataTransfer } as unknown as React.DragEvent);
        expect(dataTransfer.effectAllowed).toBe('copyMove');
        expect(setData).toHaveBeenCalledWith('application/x-ambit-image-ids', JSON.stringify([...selected]));
        expect(setData).toHaveBeenCalledWith('text/plain', 'ambit:2 images');

        view.rerender(<GridItem {...createProps(baseStyle)} selectedIds={new Set()} />);
        setData.mockClear();
        imageCardCapture.current!.onDragStart({ dataTransfer } as unknown as React.DragEvent);
        expect(setData).toHaveBeenCalledWith('application/x-ambit-image-ids', JSON.stringify([image.id]));
    });

    it('logs drag-data failures without breaking interaction', () => {
        const error = new Error('blocked');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<GridItem {...createProps(baseStyle)} />);

        imageCardCapture.current!.onDragStart({
            dataTransfer: {
                effectAllowed: 'none',
                setData: () => { throw error; },
            },
        } as unknown as React.DragEvent);

        expect(consoleError).toHaveBeenCalledWith('[GridItem] Failed to set drag data:', error);
        consoleError.mockRestore();
    });

    it('marks an image missing only when path verification confirms it', async () => {
        verifyImagePathsMock.mockResolvedValueOnce({ status: 'ok', data: ['file:/image-1.png'] });
        const setImages = vi.fn();
        render(<GridItem {...createProps(baseStyle)} setImages={setImages} />);

        imageCardCapture.current!.onImageError();

        await waitFor(() => expect(setImages).toHaveBeenCalledOnce());
        const updater = setImages.mock.calls[0][0] as (images: AIImage[]) => AIImage[];
        const other = { ...image, id: 'other' };
        expect(updater([image, other])).toEqual([{ ...image, isMissing: true }, other]);
    });

    it('warns when a failed image load still points to an existing file', async () => {
        verifyImagePathsMock.mockResolvedValueOnce({ status: 'ok', data: [] });
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const setImages = vi.fn();
        render(<GridItem {...createProps(baseStyle)} setImages={setImages} />);

        imageCardCapture.current!.onImageError();

        await waitFor(() => expect(consoleWarn).toHaveBeenCalled());
        expect(setImages).not.toHaveBeenCalled();
        consoleWarn.mockRestore();
    });

    it.each([
        [{ status: 'error', error: 'verification failed' }],
        [new Error('offline')],
    ])('logs path verification failures', async (outcome) => {
        if (outcome instanceof Error) verifyImagePathsMock.mockRejectedValueOnce(outcome);
        else verifyImagePathsMock.mockResolvedValueOnce(outcome);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<GridItem {...createProps(baseStyle)} />);

        imageCardCapture.current!.onImageError();

        await waitFor(() => expect(consoleError).toHaveBeenCalled());
        consoleError.mockRestore();
    });

    it('does not verify known-missing images or launch duplicate verification', async () => {
        const pending = new Promise(() => undefined);
        verifyImagePathsMock.mockReturnValueOnce(pending);
        const view = render(<GridItem {...createProps(baseStyle)} />);
        imageCardCapture.current!.onImageError();
        imageCardCapture.current!.onImageError();
        expect(verifyImagePathsMock).toHaveBeenCalledOnce();

        view.unmount();
        render(<GridItem {...createProps(baseStyle)} image={{ ...image, isMissing: true }} />);
        imageCardCapture.current!.onImageError();
        expect(verifyImagePathsMock).toHaveBeenCalledOnce();
    });

    it('renders stack layers and a pinned stack badge', () => {
        const stackedImage = {
            ...image,
            isPinned: true,
            stack: [image, { ...image, id: 'image-2' }],
        };
        render(<GridItem {...createProps(baseStyle)} image={stackedImage} />);

        expect(screen.getByTitle('2 versions stacked')).not.toBeNull();
        expect(screen.getByText('2')).not.toBeNull();
    });

    it('renders an unpinned stack badge', () => {
        render(<GridItem
            {...createProps(baseStyle)}
            image={{ ...image, stack: [image, { ...image, id: 'image-2' }] }}
        />);

        expect(screen.getByTitle('2 versions stacked').className).not.toContain('mt-8');
    });

    it('rerenders for late size and layout fields in the memo comparison', () => {
        const props = createProps(baseStyle);
        const view = render(<GridItem {...props} />);
        const expectWidth = (value: number) => expect(getGridItemRoot().style.width).toBe(`${value}px`);

        view.rerender(<GridItem {...props} />);
        view.rerender(<GridItem {...props} style={{ ...baseStyle, width: 121 }} />);
        expectWidth(121);
        view.rerender(<GridItem {...props} style={{ ...baseStyle, width: 121, height: 91 }} />);
        expect(getGridItemRoot().style.height).toBe('91px');
        view.rerender(<GridItem {...props} style={{ ...baseStyle, width: 121, height: 91 }} layoutPos={{ ...layoutPos, x: 1 }} />);
        expect(getGridItemRoot().style.width).toBe('121px');
        view.rerender(<GridItem {...props} style={{ ...baseStyle, width: 121, height: 91 }} layoutPos={{ ...layoutPos, x: 1, y: 1 }} />);
        expect(getGridItemRoot().style.height).toBe('91px');
    });
});
