import { act, fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartImage } from '../SmartImage';

const mocks = vi.hoisted(() => ({
    convertFileSrc: vi.fn((path: string) => `asset://${path}`),
    ensureAssetPathAccessible: vi.fn()
}));

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: mocks.convertFileSrc
}));

vi.mock('../../../../services/assetScope', () => ({
    ensureAssetPathAccessible: mocks.ensureAssetPathAccessible
}));

describe('SmartImage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.ensureAssetPathAccessible.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders an empty placeholder when neither primary nor fallback source exists', () => {
        const { container } = render(<SmartImage src="" alt="Missing" className="size-8" />);

        expect(container.querySelector('svg')).toBeTruthy();
        expect(screen.queryByAltText('Missing')).toBeNull();
        expect(mocks.ensureAssetPathAccessible).toHaveBeenCalledWith('');
    });

    it('registers local image paths, converts them once, and reports successful loads', async () => {
        const onLoad = vi.fn();

        render(
            <SmartImage
                src="C:/library/image.png"
                fallbackSrc="C:/library/source.png"
                alt="Generated image"
                onLoad={onLoad}
                imgClassName="custom-img"
            />
        );

        const img = screen.getByAltText('Generated image');
        expect(img.getAttribute('src')).toBe('asset://C:/library/image.png');
        expect(img.className).toContain('custom-img');

        fireEvent.load(img);

        await waitFor(() => {
            expect(onLoad).toHaveBeenCalledTimes(1);
        });
        expect(mocks.ensureAssetPathAccessible).toHaveBeenCalledWith('C:/library/image.png');
        expect(mocks.ensureAssetPathAccessible).toHaveBeenCalledWith('C:/library/source.png');
        expect(mocks.convertFileSrc).toHaveBeenCalledWith('C:/library/image.png');
    });

    it('shows a micro preview while loading and removes it after the real image loads', () => {
        render(
            <SmartImage
                src="C:/library/image.png"
                microSrc="data:image/webp;base64,abc"
                alt="Generated image"
                objectFit="contain"
            />
        );

        const preview = document.querySelector('img[aria-hidden="true"]');
        expect(preview?.getAttribute('src')).toBe('data:image/webp;base64,abc');

        fireEvent.load(screen.getByAltText('Generated image'));

        expect(document.querySelector('img[aria-hidden="true"]')).toBeNull();
    });

    it('delays shimmer until slow loads need a placeholder', async () => {
        vi.useFakeTimers();
        const { container } = render(<SmartImage src="C:/library/slow.png" alt="Slow image" />);

        expect(container.querySelector('.animate-shimmer')).toBeNull();

        await act(async () => {
            vi.advanceTimersByTime(51);
        });

        expect(container.querySelector('.animate-shimmer')).toBeTruthy();
    });

    it('adds retry cache busters before swapping to the fallback source', async () => {
        vi.useFakeTimers();
        render(
            <SmartImage
                src="C:/library/thumb.webp"
                fallbackSrc="C:/library/source.png"
                alt="Generated image"
            />
        );

        const img = screen.getByAltText('Generated image');
        fireEvent.error(img);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(500);
        });
        expect(img.getAttribute('src')).toBe('asset://C:/library/thumb.webp?retry=1');

        fireEvent.error(img);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        expect(img.getAttribute('src')).toBe('asset://C:/library/thumb.webp?retry=2');

        fireEvent.error(img);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2000);
        });
        expect(img.getAttribute('src')).toBe('asset://C:/library/thumb.webp?retry=3');

        fireEvent.error(img);

        await act(async () => {
            await Promise.resolve();
        });
        expect(img.getAttribute('src')).toBe('asset://C:/library/source.png');
    });

    it('surfaces terminal load failures with the decoded filename', async () => {
        vi.useFakeTimers();
        const onImageError = vi.fn();

        render(
            <SmartImage
                src="C:/library/Broken.png"
                alt="Broken image"
                onImageError={onImageError}
            />
        );

        for (const delay of [500, 1000, 2000]) {
            await act(async () => {
                fireEvent.error(screen.getByAltText('Broken image'));
                await vi.advanceTimersByTimeAsync(delay);
            });
        }
        expect(screen.getByAltText('Broken image').getAttribute('src')).toContain('retry=3');
        fireEvent.error(screen.getByAltText('Broken image'));

        expect(onImageError).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Failed to load')).toBeTruthy();
        expect(screen.getByText('Broken.png')).toBeTruthy();
        expect(mocks.convertFileSrc).toHaveBeenCalledWith('C:/library/Broken.png');
    });

    it('keeps a loaded image visible across source changes and detects cached replacements', () => {
        const { rerender } = render(<SmartImage src="C:/one.png" alt="Changing image" />);
        const img = screen.getByAltText('Changing image');
        fireEvent.load(img);
        Object.defineProperties(img, {
            complete: { configurable: true, value: true },
            naturalWidth: { configurable: true, value: 100 },
        });

        rerender(<SmartImage src="C:/two.png" alt="Changing image" />);

        expect(img.getAttribute('src')).toBe('asset://C:/two.png');
        expect(img.className).toContain('opacity-100');
    });

    it('resets an error state when the source changes', async () => {
        vi.useFakeTimers();
        const { rerender } = render(<SmartImage src="C:/broken.png" alt="Reset image" />);
        const onError = vi.fn();

        for (const delay of [500, 1000, 2000]) {
            fireEvent.error(screen.getByAltText('Reset image'));
            await act(async () => vi.advanceTimersByTimeAsync(delay));
        }
        fireEvent.error(screen.getByAltText('Reset image'));
        expect(screen.getByText('Failed to load')).toBeTruthy();

        rerender(<SmartImage src="C:/replacement.png" alt="Reset image" onError={onError} />);

        expect(screen.getByAltText('Reset image')).toBeTruthy();
    });

    it('logs path registration failures without preventing rendering or fallback swap', async () => {
        vi.useFakeTimers();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        mocks.ensureAssetPathAccessible.mockRejectedValue(new Error('scope denied'));
        render(
            <SmartImage
                src="C:/thumb.png"
                fallbackSrc="C:/source.png"
                alt="Scoped image"
            />
        );

        await act(async () => Promise.resolve());
        expect(warn).toHaveBeenCalledWith(
            '[SmartImage] Failed to register current image path',
            expect.any(Error)
        );
        expect(warn).toHaveBeenCalledWith(
            '[SmartImage] Failed to register fallback image path',
            expect.any(Error)
        );

        for (const delay of [500, 1000, 2000]) {
            fireEvent.error(screen.getByAltText('Scoped image'));
            await act(async () => vi.advanceTimersByTimeAsync(delay));
        }
        fireEvent.error(screen.getByAltText('Scoped image'));
        await act(async () => Promise.resolve());

        expect(warn).toHaveBeenCalledWith(
            '[SmartImage] Failed to register fallback before swap',
            expect.any(Error)
        );
        expect(screen.getByAltText('Scoped image').getAttribute('src')).toBe('asset://C:/source.png');
        warn.mockRestore();
    });

    it('forwards image errors and appends retries to URLs with existing queries', async () => {
        vi.useFakeTimers();
        const onError = vi.fn();
        render(<SmartImage src="https://example.test/image.png?v=1" alt="Remote image" onError={onError} />);

        await act(async () => {
            fireEvent.error(screen.getByAltText('Remote image'));
            await vi.advanceTimersByTimeAsync(500);
        });

        expect(onError).toHaveBeenCalledTimes(1);
        expect(screen.getByAltText('Remote image').getAttribute('src')).toBe(
            'https://example.test/image.png?v=1&retry=1'
        );
        expect(mocks.convertFileSrc).not.toHaveBeenCalled();
    });

    it.each([
        ['asset://localhost/C%3A/image.png', 'asset://localhost/C:/image.png'],
        ['blob:https://example.test/id', 'blob:https://example.test/id'],
        ['data:image/png;base64,abc', 'data:image/png;base64,abc'],
        ['', ''],
    ])('preserves supported source %s', (src, expected) => {
        const { container } = render(<SmartImage src={src} fallbackSrc="fallback.png" alt={`Image ${src}`} />);

        expect(container.querySelector('img')?.getAttribute('src') ?? '').toBe(expected);
    });

    it('survives URL conversion and filename decoding failures', async () => {
        vi.useFakeTimers();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        mocks.convertFileSrc.mockImplementationOnce(() => {
            throw new Error('conversion failed');
        });
        render(<SmartImage src="C:/bad.png" alt="Bad URL" />);
        expect(screen.getByAltText('Bad URL').getAttribute('src')).toBe('C:/bad.png');
        expect(warn).toHaveBeenCalledWith(
            '[SmartImage] Error normalizing URL:',
            expect.any(Error),
            { currentSrc: 'C:/bad.png' }
        );

        const malformed = 'https://example.test/%E0%A4%A';
        const { rerender } = render(<SmartImage src={malformed} alt="Malformed URL" />);
        for (const delay of [500, 1000, 2000]) {
            fireEvent.error(screen.getByAltText('Malformed URL'));
            await act(async () => vi.advanceTimersByTimeAsync(delay));
        }
        fireEvent.error(screen.getByAltText('Malformed URL'));
        expect(screen.getByText('Unknown Image')).toBeTruthy();
        rerender(<SmartImage src="https://example.test/" alt="Malformed URL" />);
        for (const delay of [500, 1000, 2000]) {
            fireEvent.error(screen.getByAltText('Malformed URL'));
            await act(async () => vi.advanceTimersByTimeAsync(delay));
        }
        fireEvent.error(screen.getByAltText('Malformed URL'));
        expect(screen.getByText('Unknown Image')).toBeTruthy();
        warn.mockRestore();
    });
});
