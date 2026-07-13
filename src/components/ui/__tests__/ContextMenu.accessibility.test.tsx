import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '../../../test/testUtils';
import { ContextMenu } from '../ContextMenu';

const renderContextMenu = () => render(
    <ContextMenu
        x={20}
        y={20}
        onClose={vi.fn()}
        onCopyPrompt={vi.fn()}
        onAddToCollection={vi.fn()}
        onTogglePin={vi.fn()}
        onDelete={vi.fn()}
        onShowInFolder={vi.fn()}
    />
);

describe('ContextMenu submenus', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('supports button activation, arrow keys, Escape, and focus-leave dismissal', () => {
        renderContextMenu();

        const trigger = screen.getByRole('button', { name: 'Copy Data' });
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(trigger.getAttribute('aria-haspopup')).toBeNull();

        fireEvent.click(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('button', { name: 'Copy Prompt' })).toBeTruthy();

        fireEvent.click(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        fireEvent.keyDown(trigger, { key: 'Enter' });
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');

        fireEvent.keyDown(trigger, { key: ' ' });
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        fireEvent.click(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        fireEvent.keyDown(trigger, { key: 'ArrowRight' });
        expect(trigger.getAttribute('aria-expanded')).toBe('true');

        fireEvent.keyDown(trigger, { key: 'ArrowLeft' });
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        fireEvent.keyDown(trigger, { key: 'ArrowRight' });
        fireEvent.keyDown(trigger, { key: 'Escape' });
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        fireEvent.keyDown(trigger, { key: 'ArrowRight' });
        fireEvent.focus(trigger);
        fireEvent.blur(trigger, { relatedTarget: document.body });
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('preserves hover opening and delayed mouse-leave dismissal', () => {
        vi.useFakeTimers();
        renderContextMenu();

        const trigger = screen.getByRole('button', { name: 'Copy Data' });
        const submenu = trigger.parentElement as HTMLElement;

        fireEvent.mouseEnter(submenu);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');

        fireEvent.mouseLeave(submenu);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');

        act(() => vi.advanceTimersByTime(149));
        expect(trigger.getAttribute('aria-expanded')).toBe('true');

        act(() => vi.advanceTimersByTime(1));
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('lets explicit clicks close and reopen a hover-opened submenu', () => {
        renderContextMenu();

        const trigger = screen.getByRole('button', { name: 'Copy Data' });
        const submenu = trigger.parentElement as HTMLElement;

        fireEvent.mouseEnter(submenu);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');

        fireEvent.click(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        fireEvent.click(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });

    it('consumes every submenu keyboard command before global shortcuts see it', () => {
        const onWindowKeyDown = vi.fn();
        window.addEventListener('keydown', onWindowKeyDown);

        try {
            renderContextMenu();
            const trigger = screen.getByRole('button', { name: 'Copy Data' });

            for (const key of ['Enter', ' ', 'ArrowRight', 'ArrowLeft', 'Escape']) {
                fireEvent.keyDown(trigger, { key });
            }

            expect(onWindowKeyDown).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener('keydown', onWindowKeyDown);
        }
    });

    it('isolates submenu-item keys without replacing native activation and returns focus on close', () => {
        const onCopyPrompt = vi.fn();
        const onWindowKeyDown = vi.fn();
        window.addEventListener('keydown', onWindowKeyDown);

        try {
            render(
                <ContextMenu
                    x={20}
                    y={20}
                    onClose={vi.fn()}
                    onCopyPrompt={onCopyPrompt}
                    onAddToCollection={vi.fn()}
                    onTogglePin={vi.fn()}
                    onDelete={vi.fn()}
                    onShowInFolder={vi.fn()}
                />
            );

            const trigger = screen.getByRole('button', { name: 'Copy Data' });
            fireEvent.click(trigger);
            let item = screen.getByRole('button', { name: 'Copy Prompt' });
            item.focus();

            fireEvent.keyDown(item, { key: 'Enter' });
            fireEvent.click(item);
            fireEvent.keyDown(item, { key: ' ' });
            fireEvent.click(item);
            fireEvent.keyDown(item, { key: 'ArrowRight' });

            expect(onCopyPrompt).toHaveBeenCalledTimes(2);
            expect(trigger.getAttribute('aria-expanded')).toBe('true');

            fireEvent.keyDown(item, { key: 'ArrowLeft' });
            expect(trigger.getAttribute('aria-expanded')).toBe('false');
            expect(document.activeElement).toBe(trigger);

            fireEvent.click(trigger);
            item = screen.getByRole('button', { name: 'Copy Prompt' });
            item.focus();
            fireEvent.keyDown(item, { key: 'Escape' });

            expect(trigger.getAttribute('aria-expanded')).toBe('false');
            expect(document.activeElement).toBe(trigger);
            expect(onWindowKeyDown).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener('keydown', onWindowKeyDown);
        }
    });

    it('exposes quick actions through shared tooltips and reports toggle state', () => {
        const onToggleFavorite = vi.fn();
        const onTogglePin = vi.fn();
        render(
            <ContextMenu
                x={20}
                y={20}
                isFavorite={true}
                isPinned={true}
                onClose={vi.fn()}
                onCopyPrompt={vi.fn()}
                onAddToCollection={vi.fn()}
                onToggleFavorite={onToggleFavorite}
                onTogglePin={onTogglePin}
                onDelete={vi.fn()}
                onShowInFolder={vi.fn()}
            />
        );

        const favoriteButton = screen.getByRole('button', { name: 'Unfavorite' });
        const pinButton = screen.getByRole('button', { name: 'Unpin' });
        expect(favoriteButton.getAttribute('aria-pressed')).toBe('true');
        expect(pinButton.getAttribute('aria-pressed')).toBe('true');
        expect(favoriteButton.getAttribute('title')).toBeNull();
        expect(pinButton.getAttribute('title')).toBeNull();

        fireEvent.focus(favoriteButton);
        expect(screen.getByRole('tooltip').textContent).toBe('Unfavorite');
        fireEvent.blur(favoriteButton);

        fireEvent.click(favoriteButton);
        fireEvent.click(pinButton);
        expect(onToggleFavorite).toHaveBeenCalledOnce();
        expect(onTogglePin).toHaveBeenCalledOnce();
    });
});
