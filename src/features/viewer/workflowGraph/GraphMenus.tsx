import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { WorkflowGraphPrefs } from '../../../types';
import type { GraphModel, WireType } from './graphModel';

export type MenuName = 'wires' | 'types';

/** ComfyUI's own names for the wire types, which its users know. */
const TYPE_NAMES: Record<WireType, string> = {
    model: 'MODEL',
    clip: 'CLIP',
    vae: 'VAE',
    cond: 'CONDITIONING',
    latent: 'LATENT',
    noise: 'NOISE',
    image: 'IMAGE',
    upscale: 'UPSCALE_MODEL',
    mask: 'MASK',
    control: 'CONTROL_NET',
    meta: 'METADATA',
    any: 'Other',
};

/** The wire types this level uses, most wires first. */
export const wireTypeCounts = (model: GraphModel): { type: WireType; name: string; count: number }[] => {
    const counts = new Map<WireType, number>();
    for (const link of model.links) counts.set(link.type, (counts.get(link.type) ?? 0) + 1);
    return [...counts]
        .map(([type, count]) => ({ type, name: TYPE_NAMES[type], count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

const SHAPES: { shape: WorkflowGraphPrefs['wireShape']; label: string; words: string; d: string; dashed?: boolean }[] = [
    { shape: 'curved', label: 'Curved', words: 'Soft curves, as ComfyUI draws them by default', d: 'M3 4C17 4 17 14 31 14' },
    { shape: 'straight', label: 'Straight', words: 'A short stub, then a straight line', d: 'M3 4h5l18 10h5' },
    { shape: 'angled', label: 'Angled', words: 'Only flat and upright lines, with round corners', d: 'M3 4h10q4 0 4 4v2q0 4 4 4h10' },
    {
        shape: 'bundled',
        label: 'Bundled',
        words: 'Wires from one output share a line and split near the end',
        d: 'M3 9h20q3 0 3-3V5q0-2 2-2h3M23 9q3 0 3 3v1q0 2 2 2h3',
    },
    { shape: 'hidden', label: 'Hidden', words: 'No wires, except those of the node you click', d: 'M3 4C17 4 17 14 31 14', dashed: true },
];

const WIDTHS: { width: WorkflowGraphPrefs['wireWidth']; label: string }[] = [
    { width: 'thin', label: 'Thin' },
    { width: 'normal', label: 'Normal' },
    { width: 'thick', label: 'Thick' },
];

const PALETTES: { palette: WorkflowGraphPrefs['palette']; label: string; words: string }[] = [
    { palette: 'familiar', label: 'Familiar', words: 'The colours ComfyUI uses, so its users know them' },
    { palette: 'quiet', label: 'Quiet', words: 'Softer tones that sit with Ambit’s sage and grey' },
];

interface GraphMenusProps {
    model: GraphModel;
    prefs: WorkflowGraphPrefs;
    onPrefs: (change: Partial<WorkflowGraphPrefs>) => void;
    open: MenuName | null;
    onOpen: (menu: MenuName | null) => void;
}

const Item: React.FC<{ on: boolean; label: string; words: string; mark: React.ReactNode; onPick: () => void }> = ({
    on,
    label,
    words,
    mark,
    onPick,
}) => (
    <button type="button" className={on ? 'wg-mi on' : 'wg-mi'} aria-pressed={on} onClick={onPick}>
        {mark}
        <span>
            <span className="ml">{label}</span>
            <span className="ms">{words}</span>
        </span>
    </button>
);

const tick = (on: boolean) => <span className="chk">{on ? <Check aria-hidden="true" className="h-3 w-3" /> : null}</span>;

/** Wires (shape, width, moving dots) and Types (the wire colours here, Quiet or Familiar), top right. */
export const GraphMenus: React.FC<GraphMenusProps> = ({ model, prefs, onPrefs, open, onOpen }) => {
    const barRef = React.useRef<HTMLDivElement>(null);
    const buttons = React.useRef<Partial<Record<MenuName, HTMLButtonElement | null>>>({});
    const counts = React.useMemo(() => wireTypeCounts(model), [model]);

    // A press outside the open menu closes it.
    React.useEffect(() => {
        if (open === null) return;
        const outside = (event: PointerEvent) => {
            if (!(event.target instanceof Node) || !barRef.current?.contains(event.target)) onOpen(null);
        };
        document.addEventListener('pointerdown', outside, true);
        return () => document.removeEventListener('pointerdown', outside, true);
    }, [open, onOpen]);

    // A menu that closes with focus inside it (Escape, a pick that closes it) hands focus back to its button.
    const shownRef = React.useRef<MenuName | null>(open);
    React.useLayoutEffect(() => {
        const was = shownRef.current;
        shownRef.current = open;
        if (was !== null && open === null && (document.activeElement === document.body || document.activeElement === null)) {
            buttons.current[was]?.focus({ preventScroll: true });
        }
    }, [open]);

    const trigger = (name: MenuName, label: string, tip: string) => (
        <button
            ref={(element) => {
                buttons.current[name] = element;
            }}
            type="button"
            className="wg-tbtn"
            aria-expanded={open === name}
            aria-controls={`wg-menu-${name}`}
            title={tip}
            onClick={() => onOpen(open === name ? null : name)}
        >
            {label}
            <ChevronDown aria-hidden="true" className="h-3 w-3" />
        </button>
    );

    return (
        <div ref={barRef} className="wg-tb wg-frost top-right" role="toolbar" aria-label="Wires and colours">
            <div className="wg-dd">
                {trigger('wires', 'Wires', 'How the wires are drawn: their shape, width and the moving dots')}
                {open === 'wires' ? (
                    <div id="wg-menu-wires" className="wg-menu wg-frost" role="group" aria-label="Wires">
                        <div className="wg-cap wg-mh">Wire shape</div>
                        {SHAPES.map((item) => (
                            <Item
                                key={item.shape}
                                on={prefs.wireShape === item.shape}
                                label={item.label}
                                words={item.words}
                                mark={
                                    <svg className="shp" viewBox="0 0 34 18" aria-hidden="true">
                                        <path d={item.d} strokeDasharray={item.dashed ? '1.5 4' : undefined} />
                                    </svg>
                                }
                                onPick={() => onPrefs({ wireShape: item.shape })}
                            />
                        ))}
                        <div className="wg-mdiv" />
                        <div className="wg-cap wg-mh">Width</div>
                        <div className="wg-seg wg-mseg" role="group" aria-label="Wire width">
                            {WIDTHS.map((item) => (
                                <button
                                    key={item.width}
                                    type="button"
                                    aria-pressed={prefs.wireWidth === item.width}
                                    onClick={() => onPrefs({ wireWidth: item.width })}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                        <div className="wg-mdiv" />
                        <Item
                            on={prefs.movingDots}
                            label="Moving dots"
                            words="Click a node: dots run along its wires, in the direction the picture flows"
                            mark={tick(prefs.movingDots)}
                            onPick={() => onPrefs({ movingDots: !prefs.movingDots })}
                        />
                    </div>
                ) : null}
            </div>
            <div className="wg-dd">
                {trigger('types', 'Types', 'What each wire colour means, and a quieter set of colours')}
                {open === 'types' ? (
                    <div id="wg-menu-types" className="wg-menu wg-frost" role="group" aria-label="Wire colours">
                        <div className="wg-cap wg-mh">Wire colours in this workflow</div>
                        {counts.length === 0 ? <p className="wg-empty wg-mrow">This level has no wires.</p> : null}
                        <ul className="wg-mlist" hidden={counts.length === 0}>
                            {counts.map((row) => (
                                <li key={row.type} className={`wg-mrow t-${row.type}`}>
                                    <span className="wg-bar" aria-hidden="true" />
                                    {row.name}
                                    <span className="n" aria-label={row.count === 1 ? '1 wire' : `${row.count} wires`}>
                                        {row.count}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        <div className="wg-mdiv" />
                        <div className="wg-cap wg-mh">Colours</div>
                        {PALETTES.map((item) => (
                            <Item
                                key={item.palette}
                                on={prefs.palette === item.palette}
                                label={item.label}
                                words={item.words}
                                mark={tick(prefs.palette === item.palette)}
                                onPick={() => {
                                    onPrefs({ palette: item.palette });
                                    onOpen(null);
                                }}
                            />
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
};
