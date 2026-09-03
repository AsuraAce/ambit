import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { MetadataSourceBadge } from './MetadataSourceBadge';

describe('MetadataSourceBadge', () => {
    it.each([
        ['trusted_sidecar', 'Source: trusted sidecar'],
        ['embedded', 'Source: embedded metadata'],
        ['user_override', 'Source: user override'],
        ['workflow_default', 'Source: workflow default'],
        ['unknown', 'Source: unknown'],
    ])('exposes %s provenance through an accessible tooltip', (source, label) => {
        render(<MetadataSourceBadge source={source} />);

        const trigger = screen.getByRole('button', { name: label });
        fireEvent.click(trigger);

        expect(screen.getByRole('tooltip').textContent).toBe(label);
    });

    it('renders nothing without provenance', () => {
        const { container } = render(<MetadataSourceBadge />);
        expect(container.firstChild).toBeNull();
    });
});
