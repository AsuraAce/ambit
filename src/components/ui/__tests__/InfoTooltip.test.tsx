import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../test/testUtils';
import { InfoTooltip } from '../InfoTooltip';

describe('InfoTooltip', () => {
    it('associates its explanation with the trigger on hover and focus', () => {
        render(<InfoTooltip label="About this option" content="Explains why this option matters." />);

        const trigger = screen.getByRole('button', { name: 'About this option' });
        expect(screen.queryByRole('tooltip')).toBeNull();

        fireEvent.mouseEnter(trigger);

        const tooltip = screen.getByRole('tooltip');
        expect(tooltip.textContent).toBe('Explains why this option matters.');
        expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id);

        fireEvent.mouseLeave(trigger);
        expect(screen.queryByRole('tooltip')).toBeNull();

        fireEvent.focus(trigger);
        expect(screen.getByRole('tooltip')).toBeTruthy();
    });

    it('stays open while either hover or keyboard focus remains active', () => {
        render(<InfoTooltip label="About this option" content="Mixed input help." />);

        const trigger = screen.getByRole('button', { name: 'About this option' });

        fireEvent.focus(trigger);
        fireEvent.mouseEnter(trigger);
        fireEvent.mouseLeave(trigger);
        expect(screen.getByRole('tooltip')).toBeTruthy();

        fireEvent.blur(trigger);
        expect(screen.queryByRole('tooltip')).toBeNull();

        fireEvent.mouseEnter(trigger);
        fireEvent.focus(trigger);
        fireEvent.blur(trigger);
        expect(screen.getByRole('tooltip')).toBeTruthy();

        fireEvent.mouseLeave(trigger);
        expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('opens on click without activating its parent and closes outside or with Escape', () => {
        const onParentClick = vi.fn();
        render(
            <div onClick={onParentClick}>
                <InfoTooltip label="About this option" content="Secondary help." />
            </div>
        );

        const trigger = screen.getByRole('button', { name: 'About this option' });
        fireEvent.click(trigger);

        expect(onParentClick).not.toHaveBeenCalled();
        expect(screen.getByRole('tooltip')).toBeTruthy();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('tooltip')).toBeNull();

        fireEvent.click(trigger);
        fireEvent.pointerDown(document.body);
        expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('consumes Escape so global shortcuts do not close the surrounding UI', () => {
        const onWindowKeyDown = vi.fn();
        window.addEventListener('keydown', onWindowKeyDown);

        try {
            render(<InfoTooltip label="About this option" content="Secondary help." />);

            const trigger = screen.getByRole('button', { name: 'About this option' });
            fireEvent.focus(trigger);
            fireEvent.keyDown(trigger, { key: 'Escape' });

            expect(screen.queryByRole('tooltip')).toBeNull();
            expect(onWindowKeyDown).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener('keydown', onWindowKeyDown);
        }
    });
});
