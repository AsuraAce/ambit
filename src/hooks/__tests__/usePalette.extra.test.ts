import { useLayoutEffect } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePalette } from '../usePalette';

class ControlledImage {
    static instances: ControlledImage[] = [];
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    crossOrigin = '';
    src = '';
    constructor() {
        ControlledImage.instances.push(this);
    }
}

describe('usePalette controlled extraction', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('extracts, quantizes, sorts, and limits visible colors', async () => {
        ControlledImage.instances = [];
        vi.stubGlobal('Image', ControlledImage);
        const pixels = new Uint8ClampedArray(400);
        const samples = [
            [255, 0, 0, 255],
            [250, 0, 0, 255],
            [0, 255, 0, 255],
            [0, 0, 255, 255],
            [200, 200, 0, 255],
            [0, 200, 200, 255],
            [200, 0, 200, 255],
            [0, 0, 0, 255],
            [50, 50, 50, 0],
        ];
        samples.forEach((sample, index) => pixels.set(sample, index * 40));
        const drawImage = vi.fn();
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
            drawImage,
            getImageData: () => ({ data: pixels }),
        } as unknown as CanvasRenderingContext2D);

        const { result } = renderHook(() => usePalette('asset://photo.png'));
        expect(ControlledImage.instances[0].crossOrigin).toBe('Anonymous');
        await act(async () => ControlledImage.instances[0].onload?.());
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(drawImage).toHaveBeenCalled();
        expect(result.current.palette).toHaveLength(5);
        expect(result.current.palette[0]).toBe('#ff0000');
    });

    it('handles missing canvas context, extraction errors, image errors, and inactive callbacks', async () => {
        ControlledImage.instances = [];
        vi.stubGlobal('Image', ControlledImage);
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
        const first = renderHook(() => usePalette('one'));
        await act(async () => ControlledImage.instances[0].onload?.());
        await waitFor(() => expect(first.result.current.isLoading).toBe(false));

        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
            throw new Error('canvas failed');
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const second = renderHook(() => usePalette('two'));
        await act(async () => ControlledImage.instances[1].onload?.());
        expect(warn).toHaveBeenCalledWith('Failed to extract palette', expect.any(Error));

        const third = renderHook(() => usePalette('three'));
        await act(async () => ControlledImage.instances[2].onerror?.());
        await waitFor(() => expect(third.result.current.isLoading).toBe(false));

        const fourth = renderHook(() => usePalette('four'));
        fourth.unmount();
        await act(async () => {
            ControlledImage.instances[3].onload?.();
            ControlledImage.instances[3].onerror?.();
        });
    });
    describe('loading state across URL changes', () => {
        const stubRedPixelCanvas = () => {
            const pixels = new Uint8ClampedArray(400);
            pixels.set([255, 0, 0, 255], 0);
            vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
                drawImage: vi.fn(),
                getImageData: () => ({ data: pixels }),
            } as unknown as CanvasRenderingContext2D);
        };

        // Every committed frame is recorded (layout effects run before passive effects), so a state that is
        // only correct after an effect has run still fails.
        const renderRecordedPalette = (initialUrl: string | null) => {
            const frames: Array<{ isLoading: boolean; palette: string[] }> = [];
            const hook = renderHook(
                ({ url }: { url: string | null }) => {
                    const value = usePalette(url);
                    useLayoutEffect(() => {
                        frames.push({ isLoading: value.isLoading, palette: value.palette });
                    });
                    return value;
                },
                { initialProps: { url: initialUrl } }
            );
            return { ...hook, frames };
        };

        it('is never loading when there is no image URL', () => {
            ControlledImage.instances = [];
            vi.stubGlobal('Image', ControlledImage);

            const { result, frames } = renderRecordedPalette(null);

            expect(frames.every((frame) => !frame.isLoading && frame.palette.length === 0)).toBe(true);
            expect(result.current).toEqual({ palette: [], isLoading: false });
            expect(ControlledImage.instances).toHaveLength(0);
        });

        it('shows loading from the first frame of a new URL until extraction finishes', async () => {
            ControlledImage.instances = [];
            vi.stubGlobal('Image', ControlledImage);
            stubRedPixelCanvas();

            const { result, rerender, frames } = renderRecordedPalette('first.png');
            await act(async () => ControlledImage.instances[0].onload?.());
            expect(result.current).toEqual({ palette: ['#ff0000'], isLoading: false });

            frames.length = 0;
            rerender({ url: 'second.png' });

            expect(frames[0].isLoading).toBe(true);
            expect(result.current.isLoading).toBe(true);

            await act(async () => ControlledImage.instances[1].onload?.());
            expect(result.current.isLoading).toBe(false);
        });

        it('clears the palette and stops loading in the first frame when the URL becomes null', async () => {
            ControlledImage.instances = [];
            vi.stubGlobal('Image', ControlledImage);
            stubRedPixelCanvas();

            const { result, rerender, frames } = renderRecordedPalette('first.png');
            await act(async () => ControlledImage.instances[0].onload?.());
            expect(result.current.palette).toEqual(['#ff0000']);

            frames.length = 0;
            rerender({ url: null });

            expect(frames.every((frame) => !frame.isLoading && frame.palette.length === 0)).toBe(true);
            expect(result.current).toEqual({ palette: [], isLoading: false });
        });
    });
});
