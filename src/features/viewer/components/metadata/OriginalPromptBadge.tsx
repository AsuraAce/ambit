import * as React from 'react';
import { History } from 'lucide-react';
import { TooltipButton } from '../../../../components/ui/InfoTooltip';

const LABEL = 'Original prompt';
const EXPLANATION =
    "ComfyUI's prompt enhancer rewrote this prompt before generating. The rewritten version isn't saved in the image, so this is the original prompt that was typed in.";

/** Marks a positive prompt recovered from before a prompt enhancer rewrote it. */
export const OriginalPromptBadge: React.FC = () => (
    <TooltipButton
        label={LABEL}
        content={EXPLANATION}
        persistOnClick
        className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-gray-200 bg-gray-100 px-2 text-[10px] font-medium text-gray-600 transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10"
    >
        <History aria-hidden="true" className="h-3 w-3" />
        {LABEL}
    </TooltipButton>
);
