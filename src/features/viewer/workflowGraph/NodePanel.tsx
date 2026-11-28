import * as React from 'react';
import { ArrowRight, Check, ChevronDown, Copy, LogIn, X } from 'lucide-react';
import { linksOf, type LinkRow } from './graphReading';
import type { GraphModel, GraphNode } from './graphModel';
import { UNNAMED_SETTING_TIP } from './GraphNode';
import { isMarkdownNote, NoteMarkdown } from './NoteMarkdown';

interface NodePanelProps {
    model: GraphModel;
    node: GraphNode;
    folded: boolean;
    onClose: () => void;
    /** Flies to another node and selects it. */
    onGo: (id: string) => void;
    onToggleFold: (id: string) => void;
    onOpen?: (id: string) => void;
}

/** The saved JSON, indented for reading when it parses; as saved when it does not. */
export const readableJson = (raw: string): string => {
    try {
        return JSON.stringify(JSON.parse(raw), null, 1);
    } catch {
        return raw;
    }
};

type CopyState = 'idle' | 'copied' | 'failed';
const COPY_FEEDBACK_MS = 1600;

const LinkRows: React.FC<{ rows: LinkRow[]; onGo: (id: string) => void; toward: string }> = ({ rows, onGo, toward }) => (
    <>
        {rows.map((row) => (
            <button
                key={row.key}
                type="button"
                className="wg-lk"
                aria-label={`${row.port} ${toward} ${row.other.title}, ${row.otherPort}. Go to that node`}
                onClick={() => onGo(row.other.id)}
            >
                <span className={`wg-sw t-${row.type}`} aria-hidden="true" />
                <span className="f">{row.port}</span>
                <span className="to">{row.other.title}</span>
                <ArrowRight aria-hidden="true" className="h-3 w-3 flex-none" />
            </button>
        ))}
    </>
);

// Every string here comes from the file and is rendered as React text only. Nothing is logged.
export const NodePanel: React.FC<NodePanelProps> = ({ model, node, folded, onClose, onGo, onToggleFold, onOpen }) => {
    const { from, to } = React.useMemo(() => linksOf(model, node.id), [model, node.id]);
    const json = React.useMemo(() => (node.rawJson === null ? null : readableJson(node.rawJson)), [node.rawJson]);
    // The feedback belongs to the node it was for, so it never shows on the next node picked.
    const [copied, setCopied] = React.useState<{ id: string; state: CopyState }>({ id: node.id, state: 'idle' });
    const copy = copied.id === node.id ? copied.state : 'idle';
    const timerRef = React.useRef<number | null>(null);
    React.useEffect(
        () => () => {
            if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        },
        []
    );
    const copyJson = () => {
        if (json === null) return;
        const id = node.id;
        const settle = (state: CopyState) => {
            setCopied({ id, state });
            if (timerRef.current !== null) window.clearTimeout(timerRef.current);
            timerRef.current = window.setTimeout(() => setCopied({ id, state: 'idle' }), COPY_FEEDBACK_MS);
        };
        const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
        if (!clipboard) {
            settle('failed');
            return;
        }
        clipboard.writeText(json).then(
            () => settle('copied'),
            () => settle('failed')
        );
    };
    const isNote = node.kind === 'note';
    const noteText = node.widgets.map((widget) => widget.value).join('\n');
    const canFold = node.kind !== 'reroute';

    return (
        <aside className="wg-panel" aria-label={`Node ${node.title}`}>
            <div className="wg-ph">
                <div className="row">
                    <span className="cls">
                        #{node.id} · {node.nodeType}
                    </span>
                    {/* The owner's look on smoke-423: Fold is a small icon beside Close, not a row of its own. */}
                    {canFold ? (
                        <button
                            type="button"
                            className="wg-tbtn"
                            aria-label={folded ? 'Unfold the node' : 'Fold the node'}
                            title={folded ? 'Unfold the node' : 'Fold the node'}
                            aria-expanded={!folded}
                            onClick={() => onToggleFold(node.id)}
                        >
                            <ChevronDown aria-hidden="true" className={folded ? 'h-3.5 w-3.5 -rotate-90' : 'h-3.5 w-3.5'} />
                        </button>
                    ) : null}
                    <button type="button" className="wg-tbtn" aria-label="Close the node details" title="Close" onClick={onClose}>
                        <X aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                </div>
                <h3>{node.title}</h3>
                {node.mode !== 'active' || onOpen ? (
                    <div className="row">
                        {node.mode === 'bypassed' ? <span className="wg-mark">Bypassed</span> : null}
                        {node.mode === 'muted' ? <span className="wg-mark mute">Muted</span> : null}
                        {onOpen ? (
                            <button type="button" className="wg-tbtn wg-pa" onClick={() => onOpen(node.id)}>
                                <LogIn aria-hidden="true" className="h-3.5 w-3.5" />
                                Open subgraph
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>
            <div className="wg-pb">
                {isNote ? (
                    <section className="wg-ps">
                        <h4 className="wg-cap">Note</h4>
                        <div className="wg-kv txt">
                            {isMarkdownNote(node.nodeType) ? <NoteMarkdown text={noteText} /> : <span className="v">{noteText}</span>}
                        </div>
                    </section>
                ) : node.widgets.length > 0 ? (
                    <section className="wg-ps">
                        <h4 className="wg-cap">Settings · {node.widgets.length}</h4>
                        {node.widgets.map((widget, index) => (
                            <div
                                key={index}
                                className={`wg-kv${widget.isLongText ? ' txt' : ''}${widget.name === null ? ' bare' : ''}`}
                                title={widget.name === null ? UNNAMED_SETTING_TIP : undefined}
                            >
                                {widget.name === null ? null : <span className="k">{widget.name}</span>}
                                <span className="v">{widget.value}</span>
                            </div>
                        ))}
                    </section>
                ) : null}
                {from.length > 0 ? (
                    <section className="wg-ps">
                        <h4 className="wg-cap">Inputs from</h4>
                        <LinkRows rows={from} onGo={onGo} toward="from" />
                    </section>
                ) : null}
                {to.length > 0 ? (
                    <section className="wg-ps">
                        <h4 className="wg-cap">Outputs to</h4>
                        <LinkRows rows={to} onGo={onGo} toward="to" />
                    </section>
                ) : null}
                {!isNote && node.widgets.length === 0 && from.length === 0 && to.length === 0 ? (
                    <p className="wg-empty">No settings and no wires.</p>
                ) : null}
                <section className="wg-ps">
                    <h4 className="wg-cap">
                        Raw JSON
                        {json === null ? null : (
                            <button type="button" className="wg-cp" onClick={copyJson}>
                                {copy === 'copied' ? (
                                    <Check aria-hidden="true" className="h-3 w-3" />
                                ) : (
                                    <Copy aria-hidden="true" className="h-3 w-3" />
                                )}
                                {copy === 'copied' ? 'Copied' : copy === 'failed' ? 'Could not copy' : 'Copy'}
                            </button>
                        )}
                    </h4>
                    {json === null ? <p className="wg-empty">Too large to show here.</p> : <pre className="wg-json">{json}</pre>}
                </section>
            </div>
            <span className="wg-sr" aria-live="polite">
                {copy === 'copied' ? 'Copied the raw JSON' : copy === 'failed' ? 'Could not copy the raw JSON' : ''}
            </span>
        </aside>
    );
};
