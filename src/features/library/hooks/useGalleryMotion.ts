import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const DEFAULT_LAYOUT_DURATION_MS = 260;
const DEFAULT_LAYOUT_SIZE_DURATION_MS = 220;
const DEFAULT_GRID_DURATION_MS = 180;
const DEFAULT_MAX_LAYOUT_ITEMS = 120;

export interface UseGalleryMotionOptions {
    transitionKey?: string;
    visibleItemCount: number;
    isScrolling?: boolean;
    layoutDurationMs?: number;
    gridDurationMs?: number;
    maxLayoutItems?: number;
}

export interface GalleryMotionState {
    shouldAnimateLayout: boolean;
    shouldAnimateGrid: boolean;
    motionAllowed: boolean;
    layoutTransition: string;
    gridTransition: string;
}

const readPrefersReducedMotion = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
    }

    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
};

const clearWindowTimer = (timerRef: MutableRefObject<number | null>) => {
    if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
    }
};

export const useGalleryMotion = ({
    transitionKey,
    visibleItemCount,
    isScrolling = false,
    layoutDurationMs = DEFAULT_LAYOUT_DURATION_MS,
    gridDurationMs = DEFAULT_GRID_DURATION_MS,
    maxLayoutItems = DEFAULT_MAX_LAYOUT_ITEMS
}: UseGalleryMotionOptions): GalleryMotionState => {
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(readPrefersReducedMotion);
    const [layoutWindowActive, setLayoutWindowActive] = useState(false);
    const [gridWindowActive, setGridWindowActive] = useState(false);

    const mountedRef = useRef(false);
    const previousKeyRef = useRef(transitionKey);
    const layoutTimerRef = useRef<number | null>(null);
    const gridTimerRef = useRef<number | null>(null);

    const keyChangedThisRender = mountedRef.current && transitionKey !== previousKeyRef.current;
    const motionAllowed = !prefersReducedMotion;
    const withinLayoutCap = visibleItemCount > 0 && visibleItemCount <= maxLayoutItems;

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return;
        }

        const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
        const handleChange = () => setPrefersReducedMotion(mediaQuery.matches);

        handleChange();
        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', handleChange);
        } else {
            mediaQuery.addListener?.(handleChange);
        }

        return () => {
            if (typeof mediaQuery.removeEventListener === 'function') {
                mediaQuery.removeEventListener('change', handleChange);
            } else {
                mediaQuery.removeListener?.(handleChange);
            }
        };
    }, []);

    useLayoutEffect(() => {
        const keyChanged = mountedRef.current && transitionKey !== previousKeyRef.current;

        previousKeyRef.current = transitionKey;
        mountedRef.current = true;

        if (prefersReducedMotion) {
            clearWindowTimer(layoutTimerRef);
            clearWindowTimer(gridTimerRef);
            setLayoutWindowActive(false);
            setGridWindowActive(false);
            return;
        }

        if (!keyChanged) {
            return;
        }

        clearWindowTimer(layoutTimerRef);
        clearWindowTimer(gridTimerRef);

        setLayoutWindowActive(true);
        setGridWindowActive(true);

        layoutTimerRef.current = window.setTimeout(() => {
            layoutTimerRef.current = null;
            setLayoutWindowActive(false);
        }, layoutDurationMs);

        gridTimerRef.current = window.setTimeout(() => {
            gridTimerRef.current = null;
            setGridWindowActive(false);
        }, gridDurationMs);
    }, [transitionKey, prefersReducedMotion, layoutDurationMs, gridDurationMs]);

    useEffect(() => {
        return () => {
            clearWindowTimer(layoutTimerRef);
            clearWindowTimer(gridTimerRef);
        };
    }, []);

    return {
        shouldAnimateLayout: motionAllowed && !isScrolling && withinLayoutCap && (keyChangedThisRender || layoutWindowActive),
        shouldAnimateGrid: motionAllowed && (keyChangedThisRender || gridWindowActive),
        motionAllowed,
        layoutTransition: [
            `transform ${layoutDurationMs}ms cubic-bezier(0.2, 1.12, 0.22, 1)`,
            `width ${DEFAULT_LAYOUT_SIZE_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
            `height ${DEFAULT_LAYOUT_SIZE_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`
        ].join(', '),
        gridTransition: `opacity ${gridDurationMs}ms ease-out`
    };
};
