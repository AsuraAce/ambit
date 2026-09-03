import * as React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { MetadataDisclosureSection } from './MetadataDisclosureSection';

describe('MetadataDisclosureSection', () => {
    it('uses a neutral full-header hover target and keeps trailing actions independent', () => {
        const onAction = vi.fn();
        render(
            <MetadataDisclosureSection
                title="Generation parameters"
                icon={SlidersHorizontal}
                trailing={<button type="button" onClick={onAction}>Copy</button>}
            >
                <p>Parameter content</p>
            </MetadataDisclosureSection>
        );

        const disclosure = screen.getByRole('button', { name: 'Generation parameters' });
        expect(disclosure.className).toContain('hover:bg-gray-100');
        expect(disclosure.className).toContain('dark:hover:bg-white/[0.04]');

        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
        expect(onAction).toHaveBeenCalledTimes(1);
        expect(disclosure.getAttribute('aria-expanded')).toBe('true');

        fireEvent.click(disclosure);
        expect(disclosure.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByText('Parameter content')).toBeNull();
    });
});
