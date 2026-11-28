import * as React from 'react';
import { ArrowRight, Box, ChevronDown, Layers, StickyNote } from 'lucide-react';
import { DOOR_H, type GraphNode as GraphNodeData, type Point } from './graphModel';
import { isMarkdownNote, NoteMarkdown } from './NoteMarkdown';

/** The tooltip on a value the file does not name. */
export const UNNAMED_SETTING_TIP = 'The file does not name this setting.';

interface GraphNodeProps {
    node: GraphNodeData;
    at: Point;
    folded: boolean;
    /** Fading out into a group being folded (and then inert), or in out of one being unfolded. */
    motion?: 'leaving' | 'arriving' | null;
    /** Picked for the side panel. */
    selected?: boolean;
    /** Where the arrow keys are, while the canvas has keyboard focus. */
    cursor?: boolean;
    /** A search is running: the node matches it, or does not. */
    found?: 'hit' | 'miss' | null;
    onToggleFold: (id: string) => void;
    /** Opens a subgraph instance's own level; absent when the report has no definition for it. */
    onOpen?: (id: string) => void;
}

const KIND_ICONS = { note: StickyNote, subgraph: Layers } as const;

export const insideCount = (count: number) => (count === 1 ? '1 node inside' : `${count} nodes inside`);

// Every string drawn here comes from the file and is rendered as React text only.
const GraphNodeView: React.FC<GraphNodeProps> = ({
    node,
    at,
    folded,
    motion = null,
    selected = false,
    cursor = false,
    found = null,
    onToggleFold,
    onOpen,
}) => {
    const style: React.CSSProperties = { transform: `translate(${at.x}px, ${at.y}px)`, width: node.width };
    const leaving = motion === 'leaving';
    const states = [motion, selected ? 'sel' : null, cursor ? 'kf' : null, found].filter(Boolean).join(' ');

    if (node.kind === 'reroute') {
        const type = node.outputs[0]?.type ?? node.inputs[0]?.type ?? 'any';
        return (
            <div className={states ? `wg-node reroute ${states}` : 'wg-node reroute'} style={style} data-node-id={node.id} inert={leaving}>
                <span className={`wg-port on t-${type}`} style={{ left: -1 }} />
                <span className={`wg-port on t-${type}`} style={{ right: -1 }} />
            </div>
        );
    }

    const Icon = node.kind === 'note' || node.kind === 'subgraph' ? KIND_ICONS[node.kind] : Box;
    const classes = ['wg-node'];
    if (node.kind === 'note') classes.push('note');
    if (node.mode === 'bypassed') classes.push('bypass');
    if (node.mode === 'muted') classes.push('mute');
    if (folded) classes.push('shut');
    if (states) classes.push(states);
    // A subgraph the report can open has a row under its body that opens it; a fold hides it with the body.
    const door = onOpen !== undefined && node.kind === 'subgraph';
    if (door) classes.push('door');
    const rows = Math.max(node.inputs.length, node.outputs.length);
    const toggle = () => onToggleFold(node.id);

    return (
        <div
            className={classes.join(' ')}
            style={folded ? style : { ...style, minHeight: node.minHeight ? node.minHeight + (door ? DOOR_H : 0) : undefined }}
            data-node-id={node.id}
            inert={leaving}
        >
            <div className="wg-nh" onDoubleClick={toggle}>
                <span className="wg-cat" aria-hidden="true">
                    <Icon className="h-[11px] w-[11px]" />
                </span>
                <span className="wg-nt" title={node.title === node.nodeType ? node.title : `${node.title} · ${node.nodeType}`}>
                    {node.title}
                </span>
                {node.mode === 'bypassed' ? <span className="wg-mark">Bypassed</span> : null}
                {node.mode === 'muted' ? <span className="wg-mark mute">Muted</span> : null}
                {/* The canvas is the graph's one Tab stop; the side panel has a Fold button for the keyboard. */}
                <button
                    type="button"
                    className="wg-cb"
                    tabIndex={-1}
                    aria-label={folded ? `Unfold ${node.title}` : `Fold ${node.title}`}
                    aria-expanded={!folded}
                    onClick={toggle}
                >
                    <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
            </div>
            {folded ? null : node.kind === 'note' ? (
                <div className="wg-nb" style={node.minHeight ? { maxHeight: node.minHeight - 31 } : undefined}>
                    {isMarkdownNote(node.nodeType) ? (
                        <NoteMarkdown text={node.widgets.map((widget) => widget.value).join('\n')} />
                    ) : (
                        node.widgets.map((widget) => widget.value).join('\n')
                    )}
                </div>
            ) : (
                <div className="wg-nb">
                    {rows > 0 ? (
                        <div className="wg-slots">
                            {Array.from({ length: rows }, (_, row) => {
                                const input = node.inputs[row];
                                const output = node.outputs[row];
                                return (
                                    <React.Fragment key={row}>
                                        <div className="wg-slot i">
                                            {input ? (
                                                <>
                                                    <span className={`wg-port t-${input.type}${input.linked ? ' on' : ''}`} />
                                                    <span>{input.label}</span>
                                                </>
                                            ) : null}
                                        </div>
                                        <div className="wg-slot o">
                                            {output ? (
                                                <>
                                                    <span>{output.label}</span>
                                                    <span className={`wg-port t-${output.type}${output.linked ? ' on' : ''}`} />
                                                </>
                                            ) : null}
                                        </div>
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    ) : null}
                    {node.widgets.map((widget, index) =>
                        widget.name === null ? (
                            <div key={index} className={widget.isLongText ? 'wg-wg txt bare' : 'wg-wg bare'} title={UNNAMED_SETTING_TIP}>
                                <span className="v">{widget.value}</span>
                            </div>
                        ) : (
                            <div key={index} className={widget.isLongText ? 'wg-wg txt' : 'wg-wg'}>
                                <span className="k">{widget.name}</span>
                                <span className="v">{widget.value}</span>
                            </div>
                        )
                    )}
                </div>
            )}
            {door && !folded ? (
                <button
                    type="button"
                    className="wg-door"
                    tabIndex={-1}
                    aria-label={
                        node.inside === null ? `Open subgraph ${node.title}` : `Open subgraph ${node.title}, ${insideCount(node.inside)}`
                    }
                    onClick={() => onOpen(node.id)}
                >
                    <span className="wg-door-label">
                        Open subgraph
                        {node.inside !== null ? <span className="wg-door-count"> · {insideCount(node.inside)}</span> : null}
                    </span>
                    <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 flex-none" />
                </button>
            ) : null}
        </div>
    );
};

export const GraphNode = React.memo(GraphNodeView);
