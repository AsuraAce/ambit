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

  it('closes on Escape and traps Tab focus inside the dialog', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        title="Delete item?"
        message="Confirm deletion."
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    const close = screen.getByRole('button', { name: 'Close Dialog' });
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: 'Tab' });
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(confirm, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('blocks dismissal and destructive controls while loading', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        isLoading
        title="Delete item?"
        message="Confirm deletion."
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(dialog);
    expect(screen.getByRole('button', { name: 'Processing...' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Processing...')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Close Dialog' })).toHaveProperty('disabled', true);
  });
});
