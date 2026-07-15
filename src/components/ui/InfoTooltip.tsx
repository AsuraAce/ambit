import * as React from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
    label: string;
    content: string;
}

type TooltipButtonProps = InfoTooltipProps & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> & {
    children: React.ReactNode;
};

interface TooltipPosition {
    left: number;
    top: number;
}

const VIEWPORT_PADDING = 12;
const TOOLTIP_GAP = 8;

export const TooltipButton: React.FC<TooltipButtonProps> = ({
    label,
    content,
    children,
    className,
    type = 'button',
    'aria-describedby': describedBy,
    onClick,
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onBlur,
    onKeyDown,
    ...buttonProps
}) => {
    const tooltipId = React.useId();
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const tooltipRef = React.useRef<HTMLDivElement>(null);
    const [isHovered, setIsHovered] = React.useState(false);
    const [isFocused, setIsFocused] = React.useState(false);
    const [isClickOpen, setIsClickOpen] = React.useState(false);
    const [isDismissed, setIsDismissed] = React.useState(false);
    const [position, setPosition] = React.useState<TooltipPosition | null>(null);
    const isOpen = !isDismissed && (isHovered || isFocused || isClickOpen);

    React.useLayoutEffect(() => {
        if (!isOpen) return;

        const updatePosition = () => {
            const trigger = triggerRef.current;
            const tooltip = tooltipRef.current;
            if (!trigger || !tooltip) return;

            const triggerRect = trigger.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            const centeredLeft = triggerRect.left + (triggerRect.width / 2) - (tooltipRect.width / 2);
            const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - tooltipRect.width - VIEWPORT_PADDING);
            const left = Math.min(Math.max(centeredLeft, VIEWPORT_PADDING), maxLeft);
            const fitsAbove = triggerRect.top >= tooltipRect.height + TOOLTIP_GAP + VIEWPORT_PADDING;
            const preferredTop = fitsAbove
                ? triggerRect.top - tooltipRect.height - TOOLTIP_GAP
                : triggerRect.bottom + TOOLTIP_GAP;
            const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - tooltipRect.height - VIEWPORT_PADDING);
            const top = Math.min(Math.max(preferredTop, VIEWPORT_PADDING), maxTop);

            setPosition({ left, top });
        };

        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);

        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [isOpen, content]);

    React.useEffect(() => {
        if (!isOpen) return;

        const handlePointerDown = (event: PointerEvent) => {
            if (!triggerRef.current?.contains(event.target as Node)) {
                setIsClickOpen(false);
                setIsDismissed(true);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setIsClickOpen(false);
                setIsDismissed(true);
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    const tooltip = isOpen ? createPortal(
        <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            style={{
                left: position?.left ?? 0,
                top: position?.top ?? 0,
                visibility: position ? 'visible' : 'hidden',
            }}
            className="pointer-events-none fixed z-[400] max-w-72 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs leading-relaxed text-gray-700 shadow-xl dark:border-white/10 dark:bg-zinc-800 dark:text-gray-200"
        >
            {content}
        </div>,
        document.body
    ) : null;

    return (
        <>
            <button
                {...buttonProps}
                ref={triggerRef}
                type={type}
                aria-label={label}
                aria-describedby={[describedBy, isOpen ? tooltipId : null].filter(Boolean).join(' ') || undefined}
                onMouseEnter={(event) => {
                    setIsHovered(true);
                    setIsDismissed(false);
                    onMouseEnter?.(event);
                }}
                onMouseLeave={(event) => {
                    setIsHovered(false);
                    onMouseLeave?.(event);
                }}
                onFocus={(event) => {
                    setIsFocused(true);
                    setIsDismissed(false);
                    onFocus?.(event);
                }}
                onBlur={(event) => {
                    setIsFocused(false);
                    setIsClickOpen(false);
                    onBlur?.(event);
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.stopPropagation();
                    }
                    onKeyDown?.(event);
                }}
                onClick={(event) => {
                    event.stopPropagation();
                    setIsHovered(false);
                    setIsClickOpen(true);
                    setIsDismissed(false);
                    onClick?.(event);
                }}
                className={className}
            >
                {children}
            </button>
            {tooltip}
        </>
    );
};

export const InfoTooltip: React.FC<InfoTooltipProps> = ({ label, content }) => (
    <TooltipButton
        label={label}
        content={content}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-sage-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50 dark:text-gray-500 dark:hover:text-sage-400"
    >
        <Info aria-hidden="true" className="h-3.5 w-3.5" />
    </TooltipButton>
);
