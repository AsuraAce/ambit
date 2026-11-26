import * as React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';

/**
 * A MarkdownNote's text, read as markdown. The text comes from the file, so only plain reading elements are made:
 * no raw HTML (skipHtml, and no rehype-raw), no images (a note must never fetch anything) and no links (their text
 * stays, as plain text). react-markdown builds React elements, never an HTML string.
 */
export const NOTE_MARKDOWN_ELEMENTS = [
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'em',
    'strong',
    'code',
    'pre',
    'blockquote',
    'hr',
    'br',
];

const components: Components = {
    // Headings stay small inside a node; the level shows in the weight only.
    h1: ({ children }) => <p className="wg-md-h">{children}</p>,
    h2: ({ children }) => <p className="wg-md-h">{children}</p>,
    h3: ({ children }) => <p className="wg-md-h">{children}</p>,
    h4: ({ children }) => <p className="wg-md-h">{children}</p>,
    h5: ({ children }) => <p className="wg-md-h">{children}</p>,
    h6: ({ children }) => <p className="wg-md-h">{children}</p>,
};

const NoteMarkdownView: React.FC<{ text: string }> = ({ text }) => (
    <div className="wg-md">
        <ReactMarkdown allowedElements={NOTE_MARKDOWN_ELEMENTS} unwrapDisallowed skipHtml components={components}>
            {text}
        </ReactMarkdown>
    </div>
);

export const NoteMarkdown = React.memo(NoteMarkdownView);

/** ComfyUI's markdown note; its plain Note shows its text as written. */
export const isMarkdownNote = (nodeType: string): boolean => nodeType === 'MarkdownNote';
