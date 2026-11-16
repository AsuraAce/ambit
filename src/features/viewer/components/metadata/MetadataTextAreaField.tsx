import * as React from 'react';
import { Code, FileText, Pencil } from 'lucide-react';
import { MetadataSourceBadge } from './MetadataSourceBadge';
import { MetadataSectionHeader } from './MetadataSectionHeader';

type MetadataTextAreaKind = 'positivePrompt' | 'negativePrompt' | 'notes';

interface MetadataTextAreaFieldProps {
    kind: MetadataTextAreaKind;
    value: string;
    onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
    onBlur?: React.FocusEventHandler<HTMLTextAreaElement>;
    source?: string;
    isDirty?: boolean;
    headerAction?: React.ReactNode;
    /** Shown in the box's top-right corner, on its own strip so the text never runs under it. */
    badge?: React.ReactNode;
    status?: React.ReactNode;
    overlay?: React.ReactNode;
    className?: string;
    readOnly?: boolean;
    readContent?: React.ReactNode;
    onCancelEdit?: (editStartValue: string) => void;
}

const FIELD_PRESENTATION = {
    positivePrompt: {
        label: 'Positive prompt',
        placeholder: 'Enter positive prompt...',
        icon: FileText,
        iconClassName: 'text-sage-500',
        heightClassName: 'h-32',
        textareaClassName: 'bg-white dark:bg-zinc-800/50 focus:border-sage-500 focus:ring-1 focus:ring-sage-500',
        frameClassName:
            'bg-white dark:bg-zinc-800/50 has-[textarea:focus]:border-sage-500 has-[textarea:focus]:ring-1 has-[textarea:focus]:ring-sage-500',
    },
    negativePrompt: {
        label: 'Negative prompt',
        placeholder: 'Enter negative prompt...',
        icon: FileText,
        iconClassName: 'text-red-400',
        heightClassName: 'h-24',
        textareaClassName: 'bg-white dark:bg-zinc-800/50 focus:border-red-400 focus:ring-1 focus:ring-red-400',
        frameClassName:
            'bg-white dark:bg-zinc-800/50 has-[textarea:focus]:border-red-400 has-[textarea:focus]:ring-1 has-[textarea:focus]:ring-red-400',
    },
    notes: {
        label: 'Notes',
        placeholder: 'Add your notes here...',
        icon: Code,
        iconClassName: 'text-gray-400',
        heightClassName: 'h-32',
        textareaClassName: 'bg-gray-50 dark:bg-zinc-800/30 focus:bg-white dark:focus:bg-zinc-800/50 focus:border-sage-500',
        frameClassName:
            'bg-gray-50 dark:bg-zinc-800/30 has-[textarea:focus]:bg-white dark:has-[textarea:focus]:bg-zinc-800/50 has-[textarea:focus]:border-sage-500',
    },
} as const;

export const MetadataTextAreaField: React.FC<MetadataTextAreaFieldProps> = ({
    kind,
    value,
    onChange,
    onBlur,
    source,
    isDirty = false,
    headerAction,
    badge,
    status,
    overlay,
    className = '',
    readOnly = false,
    readContent,
    onCancelEdit,
}) => {
    const field = FIELD_PRESENTATION[kind];
    const Icon = field.icon;
    const textareaId = React.useId();
    const dirtyClassName =
        isDirty && kind !== 'notes'
            ? 'border-ember-300 bg-ember-50/70 dark:border-ember-500/50 dark:bg-ember-500/10'
            : 'border-gray-200 dark:border-white/10';
    const [isEditing, setIsEditing] = React.useState(readContent === undefined);
    const editButtonRef = React.useRef<HTMLButtonElement>(null);
    const editStartValueRef = React.useRef(value);
    const restoreEditFocusRef = React.useRef(false);
    const showsReadSurface = readContent !== undefined && !isEditing;
    const canEdit = readContent !== undefined && !readOnly;
    // With a badge, a wrapper draws the box and the text scrolls below the badge strip.
    const framed = badge !== undefined && badge !== null;
    const surfaceClassName = framed
        ? 'min-h-0 flex-1 bg-transparent px-3 pb-3 pt-1 focus-visible:ring-inset'
        : `rounded-xl border p-3 ${field.heightClassName} ${field.textareaClassName} ${dirtyClassName}`;
    const readOnlyClassName = readOnly ? ' cursor-default opacity-80' : '';

    React.useLayoutEffect(() => {
        if (!showsReadSurface || !restoreEditFocusRef.current) return;
        restoreEditFocusRef.current = false;
        editButtonRef.current?.focus();
    }, [showsReadSurface]);

    const handleBlur: React.FocusEventHandler<HTMLTextAreaElement> = (event) => {
        onBlur?.(event);
        if (readContent !== undefined && !event.defaultPrevented) setIsEditing(false);
    };

    const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
        if (event.key !== 'Escape' || readContent === undefined) return;
        event.preventDefault();
        onCancelEdit?.(editStartValueRef.current);
        restoreEditFocusRef.current = true;
        setIsEditing(false);
    };

    const handleStartEditing = () => {
        editStartValueRef.current = value;
        setIsEditing(true);
    };

    const editAction =
        canEdit && showsReadSurface ? (
            <button
                ref={editButtonRef}
                type="button"
                aria-label={'Edit ' + field.label}
                title={'Edit ' + field.label}
                onClick={handleStartEditing}
                className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-sage-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50 dark:text-zinc-500 dark:hover:bg-white/5 dark:hover:text-sage-300"
            >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
        ) : null;

    const surface = showsReadSurface ? (
        <div
            role="textbox"
            tabIndex={0}
            aria-readonly="true"
            aria-multiline="true"
            aria-labelledby={textareaId + '-heading'}
            className={
                'w-full overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm text-gray-800 outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50 dark:text-zinc-200 ' +
                surfaceClassName +
                readOnlyClassName
            }
        >
            {value ? readContent : <span className="text-gray-400">{field.placeholder}</span>}
        </div>
    ) : (
        <textarea
            id={textareaId}
            aria-label={field.label}
            value={value}
            onChange={onChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            autoFocus={readContent !== undefined}
            readOnly={readOnly}
            placeholder={field.placeholder}
            className={`w-full resize-none font-sans text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 dark:text-zinc-200 ${surfaceClassName}${readOnlyClassName}`}
        />
    );

    return (
        <div className={className}>
            <MetadataSectionHeader
                title={field.label}
                icon={Icon}
                iconClassName={field.iconClassName}
                labelFor={showsReadSurface ? undefined : textareaId}
                headingId={showsReadSurface ? textareaId + '-heading' : undefined}
                trailing={
                    headerAction || source || editAction ? (
                        <>
                            {headerAction}
                            {editAction}
                            <MetadataSourceBadge source={source} />
                        </>
                    ) : undefined
                }
                className="mb-2"
            />
            <div className="relative">
                {framed ? (
                    <div
                        className={`flex flex-col overflow-hidden rounded-xl border transition-colors ${field.heightClassName} ${field.frameClassName} ${dirtyClassName}`}
                    >
                        <div className="flex shrink-0 justify-end px-2 pt-2">{badge}</div>
                        {surface}
                    </div>
                ) : (
                    surface
                )}
                {status}
                {!showsReadSurface ? overlay : null}
            </div>
        </div>
    );
};
