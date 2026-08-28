import { fireEvent, render, screen } from '../../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import { MetadataRecoveryModal } from '../MetadataRecoveryModal';

describe('MetadataRecoveryModal', () => {
    it('renders nothing while closed', () => {
        const { container } = render(<MetadataRecoveryModal isOpen={false} onClose={vi.fn()} onConfirm={vi.fn()} isProcessing={false} />);
        expect(container.firstChild).toBeNull();
    });

    it('selects a recovery style, confirms it, and supports both close controls', () => {
        const onClose = vi.fn();
        const onConfirm = vi.fn();
        const { container } = render(<MetadataRecoveryModal isOpen onClose={onClose} onConfirm={onConfirm} isProcessing={false} />);
        fireEvent.click(screen.getByText('Midjourney Style'));
        fireEvent.click(screen.getByText('Generate Prompt'));
        expect(onConfirm).toHaveBeenCalledWith('midjourney');
        fireEvent.click(screen.getByText('Cancel'));
        fireEvent.click(container.querySelector('.absolute.inset-0') as HTMLElement);
        expect(onClose).toHaveBeenCalledTimes(2);
        const selectedOption = screen.getByText('Midjourney Style').closest('button');
        const recoveryIcon = screen.getByText('AI Prompt Recovery').closest('.flex.items-center.gap-3')?.querySelector('svg');
        const selectedIcon = selectedOption?.querySelector('svg');
        expect(selectedOption?.className).toContain('border-amethyst-500');
        expect(recoveryIcon?.getAttribute('class')).toContain('text-amethyst-600');
        expect(recoveryIcon?.getAttribute('class')).toContain('dark:text-amethyst-300');
        expect(selectedIcon?.parentElement?.className).toContain('text-amethyst-600');
        expect(selectedIcon?.parentElement?.className).toContain('dark:text-amethyst-300');
        expect(screen.getByText('Midjourney Style').className).toContain('text-amethyst-600');
        expect(screen.getByText('Midjourney Style').className).toContain('dark:text-amethyst-300');
        fireEvent.click(container.querySelector('button:not([class*="px-4"]):not([class*="w-full"]):not([class*="px-5"])') as HTMLElement);
        expect(onClose).toHaveBeenCalledTimes(3);
    });

    it('locks closing controls while processing', () => {
        const onClose = vi.fn();
        const { container } = render(<MetadataRecoveryModal isOpen onClose={onClose} onConfirm={vi.fn()} isProcessing />);
        expect(screen.getByText('Analyzing Image...')).toBeTruthy();
        expect(screen.queryByText('Cancel')).toBeNull();
        fireEvent.click(container.querySelector('.absolute.inset-0') as HTMLElement);
        expect(onClose).not.toHaveBeenCalled();
    });
});
