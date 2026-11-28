import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGraphModel } from '../graphModel';
import { UNNAMED_SETTING_TIP } from '../GraphNode';
import { NodePanel, readableJson } from '../NodePanel';
import { NoteMarkdown } from '../NoteMarkdown';
import { canvasLink, canvasNode, level, port } from './canvasFixtures';

const RAW = '{"id":7,"type":"KSampler","widgets_values":[42,"euler"]}';
const model = buildGraphModel(
    level(
        [
            canvasNode('1', { title: 'Load', outputs: [port(0, 'MODEL')] }),
            canvasNode('7', {
                title: 'Sampler <b>bold</b>',
                nodeType: 'KSampler',
                mode: 'bypassed',
                inputs: [port(0, 'MODEL')],
                outputs: [port(0, 'LATENT')],
                widgets: [
                    { name: 'seed', value: '42', isLongText: false },
                    { name: null, value: 'euler', isLongText: false },
                ],
                rawJson: RAW,
            }),
            canvasNode('9', { title: 'Decode', inputs: [port(0, 'LATENT')] }),
        ],
        [canvasLink('1', 0, '7', 0, 'MODEL'), canvasLink('7', 0, '9', 0)]
    )
);

const renderPanel = (id = '7', extra: Partial<React.ComponentProps<typeof NodePanel>> = {}) => {
    const props = { onClose: vi.fn(), onGo: vi.fn(), onToggleFold: vi.fn() };
    render(<NodePanel model={model} node={model.byId.get(id)!} folded={false} {...props} {...extra} />);
    return props;
};

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('NodePanel', () => {
    it('shows the node’s settings, its wires both ways and its raw JSON, all as plain text', () => {
        renderPanel();
        expect(screen.getByRole('heading', { name: 'Sampler <b>bold</b>' })).toBeTruthy();
        expect(document.querySelector('.wg-panel b')).toBeNull();
        expect(screen.getByText('#7 · KSampler')).toBeTruthy();
        expect(screen.getByText('Bypassed')).toBeTruthy();
        expect(screen.getByText('seed')).toBeTruthy();
        expect(screen.getByRole('button', { name: /^model from Load/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /^latent to Decode/ })).toBeTruthy();
        expect(screen.getByText(readableJson(RAW), { normalizer: (text) => text })).toBeTruthy();
    });

    // The owner's provisional wording: a value the file does not name shows alone, with no made-up name.
    it('shows a value the file does not name on its own, with a tooltip saying why', () => {
        renderPanel();
        const row = screen.getByText('euler').closest('.wg-kv');
        expect(row?.classList.contains('bare')).toBe(true);
        expect(row?.getAttribute('title')).toBe(UNNAMED_SETTING_TIP);
        expect(row?.querySelector('.k')).toBeNull();
        expect(screen.queryByText(/Value \d/)).toBeNull();
    });

    it('goes to the other node from a wire row', () => {
        const { onGo } = renderPanel();
        fireEvent.click(screen.getByRole('button', { name: /^latent to Decode/ }));
        expect(onGo).toHaveBeenCalledWith('9');
    });

    it('copies the raw JSON as shown, and says so', async () => {
        vi.useFakeTimers();
        const writeText = vi.fn(() => Promise.resolve());
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        renderPanel();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
        });
        expect(writeText).toHaveBeenCalledWith(readableJson(RAW));
        expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
        act(() => vi.advanceTimersByTime(2000));
        expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    });

    it('says so when the clipboard refuses', async () => {
        vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('no')) } });
        renderPanel();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
        });
        expect(screen.getByRole('button', { name: 'Could not copy' })).toBeTruthy();
    });

    it('says the JSON is too large when the report left it out, with nothing to copy', () => {
        renderPanel('9');
        expect(screen.getByText('Too large to show here.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    });

    it('keeps JSON that does not parse as saved', () => {
        expect(readableJson('{oops')).toBe('{oops');
        expect(readableJson('{"a":1}')).toBe('{\n "a": 1\n}');
    });

    it('folds the node and offers Open only for a subgraph it can open', () => {
        const { onToggleFold } = renderPanel();
        // An icon beside Close, so its name and tooltip say what it does.
        const fold = screen.getByRole('button', { name: 'Fold the node' });
        expect(fold.getAttribute('title')).toBe('Fold the node');
        expect(fold.closest('.row')?.querySelector('[aria-label="Close the node details"]')).toBeTruthy();
        fireEvent.click(fold);
        expect(onToggleFold).toHaveBeenCalledWith('7');
        expect(screen.queryByRole('button', { name: 'Open subgraph' })).toBeNull();
    });
});

describe('NoteMarkdown', () => {
    // A note comes from the file: markdown reads as text, but it never makes a link, an image (a fetch) or raw HTML.
    it('renders markdown as plain reading elements, with no links, images or raw HTML', () => {
        const { container } = render(
            <NoteMarkdown
                text={
                    '# Guide\n\nUse **this** [model](https://example.com/x).\n\n![pic](https://example.com/p.png)\n\n<script>alert(1)</script><b>raw</b>\n\n- one\n- two'
                }
            />
        );
        expect(container.querySelector('strong')?.textContent).toBe('this');
        expect(container.querySelectorAll('li')).toHaveLength(2);
        expect(container.querySelector('.wg-md-h')?.textContent).toBe('Guide');
        expect(container.querySelector('a, img, script, b, h1')).toBeNull();
        expect(container.textContent).toContain('model');
        expect(container.textContent).not.toContain('# Guide');
        expect(container.innerHTML).not.toContain('example.com');
    });
});
