import * as React from 'react';
import { Box, ChevronDown, Layers, StickyNote } from 'lucide-react';
import type { GraphNode as GraphNodeData, Point } from './graphModel';

interface GraphNodeProps {
    node: GraphNodeData;
    at: Point;
    folded: boolean;
    /** Fading out into a group being folded (and then inert), or in out of one being unfolded. */
    motion?: 'leaving' | 'arriving' | null;
    onToggleFold: (id: string) => void;
}

const KIND_ICONS = { note: StickyNote, subgraph: Layers } as const;

// Every string drawn here comes from the file and is rendered as React text only.
const GraphNodeView: React.FC<GraphNodeProps> = ({ node, at, folded, motion = null, onToggleFold }) => {
    const style: React.CSSProperties = { transform: `translate(${at.x}px, ${at.y}px)`, width: node.width };
    const leaving = motion === 'leaving';

    if (node.kind === 'reroute') {
        const type = node.outputs[0]?.type ?? node.inputs[0]?.type ?? 'any';
        return (
            <div className={motion ? `wg-node reroute ${motion}` : 'wg-node reroute'} style={style} data-node-id={node.id} inert={leaving}>
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
    if (motion) classes.push(motion);
    const rows = Math.max(node.inputs.length, node.outputs.length);
    const toggle = () => onToggleFold(node.id);

    return (
        <div
            className={classes.join(' ')}
            style={folded ? style : { ...style, minHeight: node.minHeight || undefined }}
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
                <button
                    type="button"
                    className="wg-cb"
                    aria-label={folded ? `Unfold ${node.title}` : `Fold ${node.title}`}
                    aria-expanded={!folded}
                    onClick={toggle}
                >
                    <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
            </div>
            {folded ? null : node.kind === 'note' ? (
                <div className="wg-nb" style={node.minHeight ? { maxHeight: node.minHeight - 31 } : undefined}>
                    {node.widgets.map((widget) => widget.value).join('\n')}
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
                    {node.widgets.map((widget, index) => (
                        <div key={index} className={widget.isLongText ? 'wg-wg txt' : 'wg-wg'}>
                            <span className="k">{widget.name}</span>
                            <span className="v">{widget.value}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export const GraphNode = React.memo(GraphNodeView);
