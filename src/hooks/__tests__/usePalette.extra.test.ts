import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePalette } from '../usePalette';

class ControlledImage {
    static instances: ControlledImage[] = [];
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    crossOrigin = '';
    src = '';
    constructor() { ControlledImage.instances.push(this); }
}

describe('usePalette controlled extraction', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('extracts, quantizes, sorts, and limits visible colors', async () => {
        ControlledImage.instances = [];
        vi.stubGlobal('Image', ControlledImage);
        const pixels = new Uint8ClampedArray(400);
        const samples = [
            [255, 0, 0, 255], [250, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255],
            [200, 200, 0, 255], [0, 200, 200, 255], [200, 0, 200, 255], [0, 0, 0, 255], [50, 50, 50, 0],
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

        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => { throw new Error('canvas failed'); });
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
});
