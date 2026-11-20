import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useDelayedBusyPresentation } from '../../hooks/useDelayedBusyPresentation';
import { useLibraryStore } from '../../stores/libraryStore';
import { useInvokeOwnerScopeStore, type RetainedOwnerScope } from '../../stores/invokeOwnerScopeStore';
import { OWNER_SWITCH_REVEAL_DELAY_MS } from './useInvokeDockPresentation';

/** How long the note after a switch stays on screen. */
export const OWNER_SWITCH_NOTE_MS = 3000;

type Tone = 'switching' | 'done' | 'kept';

interface SwitchNote {
    operationId: symbol;
    text: string;
    tone: Tone;
}

const DOT_CLASS: Record<Tone, string> = {
    switching: 'bg-harbor-500',
    done: 'bg-sage-500',
    kept: 'bg-ember-500',
};

const PILL_CLASS =
    'pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/80 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/80 dark:text-zinc-200';

const scopeOwnerKey = (scope: RetainedOwnerScope['scope'] | undefined): string =>
    scope?.mode === 'owner' ? `owner:${scope.ownerId}` : (scope?.mode ?? 'none');

/**
 * Says which owner's images are on screen around a user owner switch (#527): while it prepares, and in a
 * short note once it swaps, is cancelled or fails. Progress and every control stay in the activity dock.
 */
export const OwnerSwitchPill: React.FC = () => {
    const retained = useInvokeOwnerScopeStore((state) => state.retainedOwnerScope);
    const reduceMotion = useReducedMotion();
    const isPendingVisible = useDelayedBusyPresentation(retained !== null, {
        revealDelayMs: OWNER_SWITCH_REVEAL_DELAY_MS,
        minimumVisibleMs: 0,
    });
    const [note, setNote] = React.useState<SwitchNote | null>(null);
    const previousRef = React.useRef<RetainedOwnerScope | null>(null);

    React.useEffect(() => {
        const previous = previousRef.current;
        previousRef.current = retained;
        if (retained) {
            // A new switch replaces the note of an earlier one at once.
            if (retained.operationId !== previous?.operationId) setNote(null);
            return;
        }
        if (!previous) return;

        const { operation, ownerScopeState } = useInvokeOwnerScopeStore.getState();
        const outcome = operation?.id === previous.operationId ? operation.phase : null;
        const admitted = ownerScopeState.status === 'ready' || ownerScopeState.status === 'offline_ready';
        const kept = `still showing ${previous.label}'s images`;
        if (outcome === 'cancelled') {
            setNote({ operationId: previous.operationId, text: `Switch cancelled · ${kept}`, tone: 'kept' });
        } else if (outcome === 'failed') {
            setNote({ operationId: previous.operationId, text: `Could not switch · ${kept}`, tone: 'kept' });
        } else if (admitted && scopeOwnerKey(ownerScopeState.scope) !== scopeOwnerKey(previous.scope)) {
            setNote({ operationId: previous.operationId, text: `Now showing ${previous.targetLabel}'s images`, tone: 'done' });
        }
    }, [retained]);

    React.useEffect(() => {
        if (!note) return;
        const timer = window.setTimeout(
            () => setNote((current) => (current?.operationId === note.operationId ? null : current)),
            OWNER_SWITCH_NOTE_MS
        );
        return () => window.clearTimeout(timer);
    }, [note]);

    const reopenDock = () => {
        const library = useLibraryStore.getState();
        library.setIsActivityDockDismissed(false);
        library.setIsActivityDockMinimized(false);
    };

    const shown: (SwitchNote & { pending: boolean }) | null =
        retained && isPendingVisible
            ? {
                  operationId: retained.operationId,
                  text: `Showing ${retained.label}'s images · switching to ${retained.targetLabel}`,
                  tone: 'switching',
                  pending: true,
              }
            : note && { ...note, pending: false };

    const dot = shown && (
        <span
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[shown.tone]} ${shown.pending ? 'motion-safe:animate-pulse' : ''}`}
        />
    );

    // The live region exists from the start of a switch, before its text arrives, and only around a switch.
    const isLiveRegion = retained !== null || note !== null;
    return (
        <div
            role={isLiveRegion ? 'status' : undefined}
            aria-live={isLiveRegion ? 'polite' : undefined}
            className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center"
        >
            <AnimatePresence>
                {shown && (
                    <motion.div
                        key={`${shown.pending ? 'pending' : shown.tone}`}
                        initial={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="pointer-events-auto"
                    >
                        {shown.pending ? (
                            <button
                                type="button"
                                onClick={reopenDock}
                                className={`${PILL_CLASS} transition-colors hover:bg-white dark:hover:bg-zinc-900`}
                            >
                                {dot}
                                {shown.text}
                            </button>
                        ) : (
                            <span className={PILL_CLASS}>
                                {dot}
                                {shown.text}
                            </span>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
