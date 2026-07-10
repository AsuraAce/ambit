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
});
