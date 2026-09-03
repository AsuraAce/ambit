import * as React from 'react';
import { render, screen } from '../../../../test/testUtils';
import { describe, expect, it } from 'vitest';
import { AssetTechnicalDetails } from './AssetTechnicalDetails';

describe('AssetTechnicalDetails', () => {
    it('uses the shared category hierarchy for technical metadata', () => {
        render(<AssetTechnicalDetails rows={[{ label: 'Dimensions', value: '320×180' }]} />);

        const heading = screen.getByRole('heading', { name: 'Technical details' });
        expect(heading.className).toContain('text-xs');
        expect(heading.className).toContain('uppercase');
        expect(heading.parentElement?.querySelector('svg')?.getAttribute('class')).toContain('text-zinc-500');
    });
});
