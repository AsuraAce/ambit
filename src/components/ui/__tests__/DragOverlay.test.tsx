import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DragOverlay } from '../DragOverlay';

describe('DragOverlay', () => {
    it('renders only while an external drag is active', () => {
        const { rerender } = render(<DragOverlay isVisible={false} />);
        expect(screen.queryByText('Drop to Import')).toBeNull();

        rerender(<DragOverlay isVisible />);
        expect(screen.getByText('Drop to Import')).toBeTruthy();
        expect(screen.getByText('Release files to add them to your library')).toBeTruthy();
    });
});
