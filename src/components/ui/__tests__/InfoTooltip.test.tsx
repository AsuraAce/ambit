import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '../../../test/testUtils';
import { InfoTooltip, TooltipButton } from '../InfoTooltip';

const ModalLauncherHarness: React.FC = () => {
    const [isOpen, setIsOpen] = React.useState(false);
    const closeButtonRef = React.useRef<HTMLButtonElement>(null);

    React.useEffect(() => {
        if (!isOpen) return;

        const previousFocus = document.activeElement;
        closeButtonRef.current?.focus();

        return () => {
            if (previousFocus instanceof HTMLElement) previousFocus.focus();
        };
    }, [isOpen]);

    return (
        <>
            <TooltipButton
                label="Open modal"
                content="Open modal"
                onClick={() => setIsOpen(true)}
            >
                Open
            </TooltipButton>
            {isOpen && (
                <div role="dialog" aria-label="Example modal">
                    <button ref={closeButtonRef} onClick={() => setIsOpen(false)}>Close</button>
                </div>
            )}
        </>
    );
};

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

        act(() => trigger.focus());
        fireEvent.click(trigger);
        expect(screen.getByRole('tooltip')).toBeTruthy();
        fireEvent.blur(trigger);
        expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('dismisses an action tooltip after activation without suppressing a later keyboard visit', () => {
        vi.useFakeTimers();
        const onClick = vi.fn();
        try {
            render(
                <TooltipButton label="Run action" content="Run action" onClick={onClick}>
                    Run
                </TooltipButton>
            );

            const trigger = screen.getByRole('button', { name: 'Run action' });
            act(() => trigger.focus());
            fireEvent.mouseEnter(trigger);
            expect(screen.getByRole('tooltip')).toBeTruthy();

            fireEvent.click(trigger);

            expect(onClick).toHaveBeenCalledTimes(1);
            expect(document.activeElement).toBe(trigger);
            expect(screen.queryByRole('tooltip')).toBeNull();

            act(() => vi.runOnlyPendingTimers());
            act(() => trigger.blur());
            act(() => trigger.focus());
            expect(screen.getByRole('tooltip')).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps a modal launcher tooltip dismissed when focus is restored', () => {
        render(<ModalLauncherHarness />);

        const trigger = screen.getByRole('button', { name: 'Open modal' });
        fireEvent.mouseEnter(trigger);
        act(() => trigger.focus());
        expect(document.activeElement).toBe(trigger);
        expect(screen.getByRole('tooltip')).toBeTruthy();

        fireEvent.click(trigger);

        const closeButton = screen.getByRole('button', { name: 'Close' });
        expect(document.activeElement).toBe(closeButton);
        expect(screen.queryByRole('tooltip')).toBeNull();

        fireEvent.click(closeButton);

        expect(document.activeElement).toBe(trigger);
        expect(screen.queryByRole('tooltip')).toBeNull();

        fireEvent.mouseEnter(trigger);
        expect(screen.getByRole('tooltip')).toBeTruthy();

        act(() => trigger.blur());
        fireEvent.mouseLeave(trigger);
        expect(screen.queryByRole('tooltip')).toBeNull();

        act(() => trigger.focus());
        expect(screen.getByRole('tooltip')).toBeTruthy();
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

    it('forwards button props while preserving a safe default type and tooltip association', () => {
        const onMouseEnter = vi.fn();
        render(
            <>
                <span id="external-help">External help</span>
                <TooltipButton
                    label="Toggle details"
                    content="Detail controls"
                    aria-describedby="external-help"
                    aria-pressed={true}
                    aria-expanded={false}
                    aria-haspopup="menu"
                    data-control="details"
                    onMouseEnter={onMouseEnter}
                >
                    Details
                </TooltipButton>
            </>
        );

        const trigger = screen.getByRole('button', { name: 'Toggle details' });
        expect(trigger.getAttribute('type')).toBe('button');
        expect(trigger.getAttribute('aria-pressed')).toBe('true');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
        expect(trigger.getAttribute('data-control')).toBe('details');
        expect(trigger.getAttribute('aria-describedby')).toBe('external-help');

        fireEvent.mouseEnter(trigger);

        const tooltip = screen.getByRole('tooltip');
        expect(onMouseEnter).toHaveBeenCalledTimes(1);
        expect(trigger.getAttribute('aria-describedby')?.split(' ')).toEqual(['external-help', tooltip.id]);
    });

    it('forwards disabled state and an explicit submit type', () => {
        render(
            <TooltipButton label="Submit action" content="Submit action" type="submit" disabled>
                Submit
            </TooltipButton>
        );

        const trigger = screen.getByRole('button', { name: 'Submit action' });
        expect(trigger.getAttribute('type')).toBe('submit');
        expect((trigger as HTMLButtonElement).disabled).toBe(true);
    });

    it.each([
        { key: 'Enter', code: 'Enter' },
        { key: ' ', code: 'Space' },
    ])('keeps $code activation local while preserving one native button action', ({ key, code }) => {
        const onClick = vi.fn();
        const onKeyDown = vi.fn();
        const onWindowKeyDown = vi.fn();
        window.addEventListener('keydown', onWindowKeyDown);

        try {
            render(
                <TooltipButton
                    label="Run action"
                    content="Run action"
                    onClick={onClick}
                    onKeyDown={onKeyDown}
                >
                    Run
                </TooltipButton>
            );

            const trigger = screen.getByRole('button', { name: 'Run action' });
            act(() => trigger.focus());
            expect(screen.getByRole('tooltip')).toBeTruthy();
            const keyDownEvent = new KeyboardEvent('keydown', {
                key,
                code,
                bubbles: true,
                cancelable: true,
            });

            fireEvent(trigger, keyDownEvent);
            fireEvent.click(trigger);

            expect(keyDownEvent.defaultPrevented).toBe(false);
            expect(onKeyDown).toHaveBeenCalledTimes(1);
            expect(onWindowKeyDown).not.toHaveBeenCalled();
            expect(onClick).toHaveBeenCalledTimes(1);
            expect(screen.queryByRole('tooltip')).toBeNull();
        } finally {
            window.removeEventListener('keydown', onWindowKeyDown);
        }
    });

    it('repositions an open tooltip when dynamic content changes its dimensions', () => {
        const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
            x: left,
            y: top,
            left,
            top,
            width,
            height,
            right: left + width,
            bottom: top + height,
            toJSON: () => ({}),
        });
        const getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockImplementation(function (this: HTMLElement) {
                if (this.getAttribute('role') === 'tooltip') {
                    const width = this.textContent === 'Short help' ? 100 : 300;
                    return rect(0, 0, width, 40);
                }
                return rect(400, 300, 20, 20);
            });

        try {
            const { rerender } = render(
                <TooltipButton label="Dynamic action" content="Short help">
                    Action
                </TooltipButton>
            );
            fireEvent.focus(screen.getByRole('button', { name: 'Dynamic action' }));

            expect(screen.getByRole('tooltip').style.left).toBe('360px');

            rerender(
                <TooltipButton label="Dynamic action" content="Long help with wider dimensions">
                    Action
                </TooltipButton>
            );

            expect(screen.getByRole('tooltip').style.left).toBe('260px');
        } finally {
            getBoundingClientRect.mockRestore();
        }
    });
});
