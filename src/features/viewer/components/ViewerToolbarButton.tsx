import * as React from 'react';
import { TooltipButton } from '../../../components/ui/InfoTooltip';

type ViewerToolbarButtonProps = Omit<React.ComponentProps<typeof TooltipButton>, 'content'> & {
    content?: string;
};

export const ViewerToolbarButton: React.FC<ViewerToolbarButtonProps> = ({
    label,
    content = label,
    className = '',
    children,
    ...buttonProps
}) => (
    <TooltipButton
        {...buttonProps}
        label={label}
        content={content}
        className={`inline-flex items-center justify-center rounded-full border border-white/5 bg-black/50 p-2.5 text-white/50 shadow-lg backdrop-blur-md transition-all hover:border-white/20 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 [&_svg]:h-5 [&_svg]:w-5 ${className}`}
    >
        {children}
    </TooltipButton>
);
