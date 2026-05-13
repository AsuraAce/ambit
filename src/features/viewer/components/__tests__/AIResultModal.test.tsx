import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '../../../../test/testUtils';
import { AIResultModal } from '../AIResultModal';

describe('AIResultModal', () => {
    it('renders AI markdown links as inert text and drops markdown images', () => {
        render(
            <AIResultModal
                isOpen
                onClose={vi.fn()}
                type="analysis"
                content={'### Analysis\n[unsafe link](javascript:alert(1))\n\n![remote](https://evil.example/pixel.png)\n\n**Safe** text'}
                onCopy={vi.fn()}
            />
        );

        expect(screen.getByText('unsafe link')).toBeTruthy();
        expect(screen.getByText('Safe')).toBeTruthy();
        expect(document.querySelector('a')).toBeNull();
        expect(document.querySelector('img[src="https://evil.example/pixel.png"]')).toBeNull();
    });
});
