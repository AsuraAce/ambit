import * as React from 'react';
import { History } from 'lucide-react';
import { TooltipButton } from '../../../../components/ui/InfoTooltip';

const LABEL = 'Original Prompt';
const EXPLANATION =
    "An AI prompt enhancer rewrote this prompt before the image was generated. The rewritten version isn't saved in the image, so this is the original prompt.";

/** Marks a positive prompt recorded before a prompt enhancer rewrote it. */
export const OriginalPromptBadge: React.FC = () => (
    <TooltipButton
        label={LABEL}
        content={EXPLANATION}
        persistOnClick
        className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 text-[10px] font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400 dark:hover:border-white/20 dark:hover:text-zinc-200"
    >
        <History aria-hidden="true" className="h-3 w-3" />
        {LABEL}
    </TooltipButton>
);
