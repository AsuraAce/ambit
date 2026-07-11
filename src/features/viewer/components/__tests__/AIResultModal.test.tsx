import { act, fireEvent, render, screen } from '../../../../test/testUtils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIResultModal } from '../AIResultModal';

describe('AIResultModal', () => {
    afterEach(() => vi.useRealTimers());

    it('renders AI markdown links as inert text and drops markdown images', () => {
        render(
            <AIResultModal
                isOpen
                onClose={vi.fn()}
                type="analysis"
                content={'### Analysis\n[unsafe link](javascript:alert(1))\n\n![remote](https://evil.example/pixel.png)\n\n**Safe** text'}
                onCopy={vi.fn()}
            />
        );

        expect(screen.getByText('unsafe link')).toBeTruthy();
        expect(screen.getByText('Safe')).toBeTruthy();
        expect(document.querySelector('a')).toBeNull();
        expect(document.querySelector('img[src="https://evil.example/pixel.png"]')).toBeNull();
    });

    it('renders nothing when closed or content is absent', () => {
        const props = { onClose: vi.fn(), type: 'analysis' as const, onCopy: vi.fn() };
        const { container, rerender } = render(<AIResultModal {...props} isOpen={false} content="analysis" />);
        expect(container.firstChild).toBeNull();
        rerender(<AIResultModal {...props} isOpen content={null} />);
        expect(container.firstChild).toBeNull();
    });

    it('switches analysis tabs, copies the applied prompt, and resets copied state', async () => {
        vi.useFakeTimers();
        const onCopy = vi.fn();
        render(
            <AIResultModal
                isOpen
                onClose={vi.fn()}
                type="analysis"
                content={'### Analysis\nA **strong** and *useful* report\n\n### Applied Example\nmastered prompt'}
                onCopy={onCopy}
            />
        );

        expect(screen.getByText('Prompt Analysis')).toBeTruthy();
        expect(screen.getByText('strong')).toBeTruthy();
        expect(screen.getByText('useful')).toBeTruthy();
        fireEvent.click(screen.getByText('Applied Example'));
        expect(screen.getByText('mastered prompt')).toBeTruthy();
        fireEvent.click(screen.getByText('Copy'));
        expect(onCopy).toHaveBeenCalledWith('mastered prompt');
        expect(screen.getByText('Copied')).toBeTruthy();
        await act(async () => vi.advanceTimersByTime(2000));
        expect(screen.getByText('Copy')).toBeTruthy();
        fireEvent.click(screen.getByText('Analysis Report'));
        expect(screen.getByText('strong')).toBeTruthy();
    });

    it('navigates variations, copies one or all, and respects navigation boundaries', async () => {
        vi.useFakeTimers();
        const onCopy = vi.fn();
        const { container } = render(
            <AIResultModal
                isOpen
                onClose={vi.fn()}
                type="variations"
                content={['first prompt', 'second prompt', 'third prompt']}
                onCopy={onCopy}
            />
        );

        expect(screen.getByText('Creative Variations')).toBeTruthy();
        expect(screen.getByText('Viewing 1 of 3')).toBeTruthy();
        const arrows = container.querySelectorAll('button:has(.lucide-chevron-left), button:has(.lucide-chevron-right)');
        expect((arrows[0] as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(arrows[1]);
        expect(screen.getByText('second prompt')).toBeTruthy();
        expect(screen.getByText('Viewing 2 of 3')).toBeTruthy();
        fireEvent.click(screen.getByText('Variation 3'));
        expect(screen.getByText('third prompt')).toBeTruthy();
        expect((arrows[1] as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(arrows[0]);
        expect(screen.getByText('second prompt')).toBeTruthy();

        fireEvent.click(screen.getByText('Copy This Variation'));
        expect(onCopy).toHaveBeenCalledWith('second prompt');
        expect(screen.getByText('Copied!')).toBeTruthy();
        await act(async () => vi.advanceTimersByTime(2000));
        expect(screen.getByText('Copy This Variation')).toBeTruthy();

        fireEvent.click(screen.getByText('Copy All'));
        expect(onCopy).toHaveBeenCalledWith('first prompt\n\nsecond prompt\n\nthird prompt');
        expect(screen.getByText('Copied')).toBeTruthy();
        await act(async () => vi.advanceTimersByTime(2000));
        expect(screen.getByText('Copy All')).toBeTruthy();
    });

    it('resets active tabs for new content and routes backdrop and close controls', () => {
        const onClose = vi.fn();
        const { container, rerender } = render(<AIResultModal isOpen onClose={onClose} type="variations" content={['one', 'two']} onCopy={vi.fn()} />);
        fireEvent.click(screen.getByText('Variation 2'));
        expect(screen.getByText('Viewing 2 of 2')).toBeTruthy();
        rerender(<AIResultModal isOpen onClose={onClose} type="variations" content={['new one', 'new two']} onCopy={vi.fn()} />);
        expect(screen.getByText('Viewing 1 of 2')).toBeTruthy();

        fireEvent.click(container.querySelector('.absolute.inset-0') as HTMLElement);
        fireEvent.click(screen.getByText('Close'));
        const headerClose = container.querySelector('.lucide-x')?.closest('button') as HTMLButtonElement;
        fireEvent.click(headerClose);
        expect(onClose).toHaveBeenCalledTimes(3);
    });

    it('omits applied-example controls when analysis has no mastered prompt', () => {
        render(<AIResultModal isOpen onClose={vi.fn()} type="analysis" content="plain analysis" onCopy={vi.fn()} />);
        expect(screen.queryByText('Applied Example')).toBeNull();
        expect(screen.getByText('plain analysis')).toBeTruthy();
    });
});
