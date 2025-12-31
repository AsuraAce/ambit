import { useCallback } from 'react';

interface UseTimelineScrollProps {
    headers: any[];
    stickyHeaderRef: React.RefObject<HTMLDivElement | null>;
    activeHeaderIdRef: React.MutableRefObject<string | null>;
    setScrollTop: (top: number) => void;
    setActiveHeaderData: (data: { date: string, count: number } | null) => void;
}

export const useTimelineScroll = ({
    headers,
    stickyHeaderRef,
    activeHeaderIdRef,
    setScrollTop,
    setActiveHeaderData
}: UseTimelineScrollProps) => {
    return useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const currentScroll = e.currentTarget.scrollTop;
        setScrollTop(currentScroll);

        if (!stickyHeaderRef.current || headers.length === 0) return;

        let active = null;
        let next = null;

        for (let i = 0; i < headers.length; i++) {
            if (headers[i].y <= currentScroll + 20) {
                active = headers[i];
            } else {
                next = headers[i];
                break;
            }
        }

        if (active) {
            if (active.id !== activeHeaderIdRef.current) {
                setActiveHeaderData({ date: active.date!, count: active.count! });
                activeHeaderIdRef.current = active.id!;
            }

            let yOffset = 0;
            const headerHeight = active.height;
            const floatMargin = 20;

            if (next) {
                const distance = next.y - currentScroll;
                const threshold = headerHeight + floatMargin;

                if (distance < threshold) {
                    yOffset = distance - threshold;
                }
            }

            stickyHeaderRef.current.style.transform = `translateY(${yOffset}px)`;
            stickyHeaderRef.current.style.opacity = '1';
            stickyHeaderRef.current.style.pointerEvents = 'auto';
        } else {
            stickyHeaderRef.current.style.opacity = '0';
            stickyHeaderRef.current.style.pointerEvents = 'none';
            activeHeaderIdRef.current = null;
        }
    }, [headers, stickyHeaderRef, activeHeaderIdRef, setScrollTop, setActiveHeaderData]);
};
