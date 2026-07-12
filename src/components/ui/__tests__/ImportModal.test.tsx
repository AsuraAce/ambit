import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../test/testUtils';
import { ImportModal } from '../ImportModal';

vi.mock('framer-motion', () => {
    type MotionDivProps = React.HTMLAttributes<HTMLDivElement> & {
        initial?: unknown;
        animate?: unknown;
        exit?: unknown;
        whileHover?: unknown;
    };

    const MotionDiv = React.forwardRef<HTMLDivElement, MotionDivProps>(({
        initial: _initial,
        animate: _animate,
        exit: _exit,
        whileHover: _whileHover,
        ...props
    }, ref) => <div ref={ref} {...props} />);

    MotionDiv.displayName = 'MotionDiv';

    return {
        AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
        motion: { div: MotionDiv },
    };
});

const renderModal = () => {
    const onClose = vi.fn();
    const onOpenSettings = vi.fn();
    const result = render(
        <ImportModal
            isOpen={true}
            onClose={onClose}
            onOpenSettings={onOpenSettings}
            onImportFiles={vi.fn()}
        />
    );

    return { ...result, onClose, onOpenSettings };
};

describe('ImportModal', () => {
    it('renders a named modal dialog and focuses its heading', () => {
        renderModal();

        const dialog = screen.getByRole('dialog', { name: 'Add Images to Your Library' });
        const heading = screen.getByRole('heading', { name: 'Add Images to Your Library' });
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(document.activeElement).toBe(heading);
        expect(screen.getByRole('button', { name: 'Close Add Images' })).not.toBeNull();
    });

    it('wraps forward and reverse focus within the dialog', () => {
        renderModal();

        const heading = screen.getByRole('heading', { name: 'Add Images to Your Library' });
        const firstControl = screen.getByRole('button', { name: 'Close Add Images' });
        const lastControl = screen.getByRole('button', { name: 'Add Folder' });

        heading.focus();
        fireEvent.keyDown(heading, { key: 'Tab' });
        expect(document.activeElement).toBe(firstControl);

        heading.focus();
        fireEvent.keyDown(heading, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(lastControl);

        lastControl.focus();
        fireEvent.keyDown(lastControl, { key: 'Tab' });
        expect(document.activeElement).toBe(firstControl);

        firstControl.focus();
        fireEvent.keyDown(firstControl, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(lastControl);
    });

    it('keeps every import path visible without permanent bypass controls', () => {
        renderModal();

        expect(screen.getByRole('button', { name: 'InvokeAI' })).not.toBeNull();
        expect(screen.getByRole('button', { name: 'ComfyUI' })).not.toBeNull();
        expect(screen.getByRole('button', { name: 'SD WebUI' })).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Select Files' })).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Add Folder' })).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
        expect(screen.queryByText("Don't show this again")).toBeNull();
    });

    it('closes before handing generator setup to Settings', () => {
        const { onClose, onOpenSettings } = renderModal();

        fireEvent.click(screen.getByRole('button', { name: 'InvokeAI' }));

        expect(onOpenSettings).toHaveBeenCalledWith('invokeai');
        expect(onClose).toHaveBeenCalledOnce();
    });
});
