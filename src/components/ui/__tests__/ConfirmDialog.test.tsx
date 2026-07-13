import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '../../../test/testUtils';
import { ConfirmDialog } from '../ConfirmDialog';
import { TooltipButton } from '../InfoTooltip';

const ConfirmDialogFocusHarness = () => {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <>
      <TooltipButton
        label="Delete item"
        content="Delete item"
        onClick={() => setIsOpen(true)}
      >
        Delete
      </TooltipButton>
      <ConfirmDialog
        isOpen={isOpen}
        title="Delete item?"
        message="This action cannot be undone."
        onConfirm={vi.fn()}
        onCancel={() => setIsOpen(false)}
      />
    </>
  );
};

describe('ConfirmDialog', () => {
  it('does not pass the click event payload to onConfirm', () => {
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        isOpen={true}
        title="Confirm action"
        message="This is a test confirmation."
        confirmLabel="Confirm"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]).toEqual([]);
  });

  it('dismisses the launcher tooltip, focuses the close button, and restores focus', () => {
    render(<ConfirmDialogFocusHarness />);
    const launcher = screen.getByRole('button', { name: 'Delete item' });
    act(() => launcher.focus());

    expect(document.activeElement).toBe(launcher);
    expect(screen.getByRole('tooltip').textContent).toBe('Delete item');

    fireEvent.click(launcher);

    const closeButton = screen.getByRole('button', { name: 'Close Dialog' });
    expect(document.activeElement).toBe(closeButton);
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.click(closeButton);
    expect(document.activeElement).toBe(launcher);
  });
});
