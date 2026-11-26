import * as React from 'react';
import { ChevronDown, Image as ImageIcon, X } from 'lucide-react';
import { SmartImage } from '../../library/components/SmartImage';
import { FLOAT_START, moveFloat, placeFloat, resizeFloat, type FloatBox, type Room } from './floatBounds';
import { reducedMotion } from './geometry';

/** The picture the viewer already shows: its display source, never a new read of the file. A video gives its poster. */
export interface FloatSource {
    src: string;
    fallbackSrc?: string;
    width: number;
    height: number;
}

/** Kept by the graph while it is open, across subgraph levels; never saved. */
export interface FloatState {
    open: boolean;
    folded: boolean;
    box: FloatBox;
}

export const FLOAT_INITIAL: FloatState = { open: true, folded: false, box: FLOAT_START };

const OPEN_MS = 280;
const CLOSE_MS = 180;
const FOLD_EASE_MS = 300;
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** Whether the window may animate: not under reduced motion, and where elements can (jsdom's cannot). */
const motionAllowed = () => typeof HTMLElement.prototype.animate === 'function' && !reducedMotion();

interface FloatingImageProps {
    source: FloatSource;
    fileName: string;
    state: FloatState;
    onState: (next: FloatState) => void;
    /** How many nodes on this level the picture points at: the output nodes, or the subgraph holding them. */
    targets: number;
    /** The pointer or focus is on the picture, or has left it. */
    onPoint: (on: boolean) => void;
    /** The picture was clicked: go to the node that saved it. */
    onPick: () => void;
}

/** The saved image, floating over the graph: drag it by its bar, resize it from the corner, fold or close it. */
export const FloatingImage: React.FC<FloatingImageProps> = ({ source, fileName, state, onState, targets, onPoint, onPick }) => {
    const rootRef = React.useRef<HTMLDivElement>(null);
    const latest = React.useRef(state);
    React.useLayoutEffect(() => {
        latest.current = state;
    });
    const aspect = source.width > 0 && source.height > 0 ? source.width / source.height : 1;
    // The canvas the window sits on: its parent, which fills the window and changes size only on a resize.
    const room = (): Room => {
        const rect = rootRef.current?.parentElement?.getBoundingClientRect();
        return { w: rect?.width ?? 0, h: rect?.height ?? 0 };
    };
    const setBox = (box: FloatBox) => {
        const current = latest.current;
        if (box.x !== current.box.x || box.y !== current.box.y || box.w !== current.box.w) onState({ ...current, box });
    };

    // Closing fades the window out before it goes, so it stays mounted while it leaves; opening fades it in.
    const [wasOpen, setWasOpen] = React.useState(state.open);
    const [leaving, setLeaving] = React.useState(false);
    if (wasOpen !== state.open) {
        setWasOpen(state.open);
        setLeaving(!state.open && motionAllowed());
    }
    React.useLayoutEffect(() => {
        const element = rootRef.current;
        if (!leaving || !element) return;
        const fade = element.animate(
            [
                { opacity: 1, scale: '1' },
                { opacity: 0, scale: '0.94' },
            ],
            { duration: CLOSE_MS, fill: 'forwards' }
        );
        fade.onfinish = () => setLeaving(false);
        // Reopened mid-fade: the fade is dropped, so nothing it held stays on the element.
        return () => fade.cancel();
    }, [leaving]);
    const firstRef = React.useRef(true);
    React.useLayoutEffect(() => {
        const first = firstRef.current;
        firstRef.current = false;
        const element = rootRef.current;
        if (first || !state.open || !element || !motionAllowed()) return;
        element.animate(
            [
                { opacity: 0, scale: '0.94' },
                { opacity: 1, scale: '1' },
            ],
            { duration: OPEN_MS, easing: EASE_OUT }
        );
    }, [state.open]);
    const visible = state.open || leaving;

    // A window that was moved to a corner stays on the canvas when the canvas shrinks, and on first show.
    React.useLayoutEffect(() => {
        if (!visible) return;
        setBox(placeFloat(latest.current.box, room()));
        const keep = () => setBox(placeFloat(latest.current.box, room()));
        window.addEventListener('resize', keep);
        return () => window.removeEventListener('resize', keep);
        // setBox and room read refs only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible]);

    // Folding eases the height between the full window and its bar.
    const foldFromRef = React.useRef<number | null>(null);
    const toggleFold = () => {
        foldFromRef.current = rootRef.current?.offsetHeight ?? null;
        onState({ ...latest.current, folded: !latest.current.folded });
    };
    React.useLayoutEffect(() => {
        const from = foldFromRef.current;
        foldFromRef.current = null;
        const element = rootRef.current;
        if (from === null || !element || !motionAllowed()) return;
        const to = element.offsetHeight;
        if (from !== to) element.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: FOLD_EASE_MS, easing: EASE_OUT });
    }, [state.folded]);

    // Nothing stays lit once the picture is hidden.
    React.useEffect(() => {
        if (!state.open || state.folded) onPoint(false);
    }, [state.open, state.folded, onPoint]);

    const dragRef = React.useRef<{ id: number; kind: 'move' | 'size'; x: number; y: number; box: FloatBox } | null>(null);
    const startDrag = (kind: 'move' | 'size', event: React.PointerEvent<HTMLElement>) => {
        if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return;
        event.preventDefault();
        dragRef.current = { id: event.pointerId, kind, x: event.clientX, y: event.clientY, box: latest.current.box };
        event.currentTarget.setPointerCapture?.(event.pointerId);
    };
    const drag = (event: React.PointerEvent<HTMLDivElement>) => {
        // The canvas under the window has its own hover; a move over the window is not its business.
        event.stopPropagation();
        const current = dragRef.current;
        if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.x;
        const dy = event.clientY - current.y;
        setBox(
            current.kind === 'move' ? moveFloat(current.box, dx, dy, room()) : resizeFloat(current.box, current.box.w + dx, aspect, room())
        );
    };
    const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.id === event.pointerId) dragRef.current = null;
    };

    if (!visible) return null;
    const linked = targets > 0;
    const pictureTip = linked
        ? 'Point at the image to light the node that saved it; click to go to that node.'
        : 'The node that saved this image is not on this level.';
    return (
        <div
            ref={rootRef}
            className={state.folded ? 'wg-float wg-frost shut' : 'wg-float wg-frost'}
            style={{ left: state.box.x, top: state.box.y, width: state.box.w }}
            role="group"
            aria-label="This image"
            data-testid="graph-float"
            onPointerMove={drag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
        >
            <div className="wg-fh" onPointerDown={(event) => startDrag('move', event)} title="Drag the bar to move the image.">
                <ImageIcon aria-hidden="true" className="h-3.5 w-3.5 flex-none" />
                <span className="wg-cap">This image</span>
                <button
                    type="button"
                    className="wg-tbtn wg-fbtn"
                    aria-label={state.folded ? 'Unfold the image' : 'Fold the image'}
                    aria-expanded={!state.folded}
                    title={state.folded ? 'Unfold the image' : 'Fold the image to its bar'}
                    onClick={toggleFold}
                >
                    <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    className="wg-tbtn wg-fbtn"
                    aria-label="Close the image"
                    title="Close the image. The Image button or I brings it back."
                    onClick={() => onState({ ...latest.current, open: false })}
                >
                    <X aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
            </div>
            <button
                type="button"
                className="wg-fpic"
                style={{ aspectRatio: String(aspect) }}
                aria-label={linked ? 'Go to the node that saved this image' : 'This image'}
                aria-disabled={linked ? undefined : true}
                title={pictureTip}
                onPointerEnter={() => linked && onPoint(true)}
                onPointerLeave={() => onPoint(false)}
                onFocus={() => linked && onPoint(true)}
                onBlur={() => onPoint(false)}
                onClick={() => linked && onPick()}
            >
                <SmartImage
                    src={source.src}
                    fallbackSrc={source.fallbackSrc}
                    alt=""
                    objectFit="contain"
                    wrapperClassName="wg-fimg"
                    imgClassName="h-full w-full"
                />
            </button>
            <div className="wg-fcap">
                <span className="wg-fn" title={fileName}>
                    {fileName}
                </span>
                {source.width > 0 && source.height > 0 ? (
                    <span>
                        {source.width} × {source.height}
                    </span>
                ) : null}
            </div>
            <span
                className="wg-grip"
                aria-hidden="true"
                title="Drag the corner to resize the image."
                onPointerDown={(event) => startDrag('size', event)}
            />
        </div>
    );
};
