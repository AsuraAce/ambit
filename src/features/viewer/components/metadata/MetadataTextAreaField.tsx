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
    status?: React.ReactNode;
    overlay?: React.ReactNode;
    className?: string;
    readOnly?: boolean;
    readContent?: React.ReactNode;
    onCancelEdit?: () => void;
}

const FIELD_PRESENTATION = {
    positivePrompt: {
        label: 'Positive prompt',
        placeholder: 'Enter positive prompt...',
        icon: FileText,
        iconClassName: 'text-sage-500',
        heightClassName: 'h-32',
        textareaClassName: 'bg-white dark:bg-zinc-800/50 focus:border-sage-500 focus:ring-1 focus:ring-sage-500',
    },
    negativePrompt: {
        label: 'Negative prompt',
        placeholder: 'Enter negative prompt...',
        icon: FileText,
        iconClassName: 'text-red-400',
        heightClassName: 'h-24',
        textareaClassName: 'bg-white dark:bg-zinc-800/50 focus:border-red-400 focus:ring-1 focus:ring-red-400',
    },
    notes: {
        label: 'Notes',
        placeholder: 'Add your notes here...',
        icon: Code,
        iconClassName: 'text-gray-400',
        heightClassName: 'h-32',
        textareaClassName: 'bg-gray-50 dark:bg-zinc-800/30 focus:bg-white dark:focus:bg-zinc-800/50 focus:border-sage-500',
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
    const dirtyClassName = isDirty && kind !== 'notes'
        ? 'border-ember-300 bg-ember-50/70 dark:border-ember-500/50 dark:bg-ember-500/10'
        : 'border-gray-200 dark:border-white/10';
    const [isEditing, setIsEditing] = React.useState(readContent === undefined);
    const showsReadSurface = readContent !== undefined && !isEditing;
    const canEdit = readContent !== undefined && !readOnly;

    const handleBlur: React.FocusEventHandler<HTMLTextAreaElement> = (event) => {
        onBlur?.(event);
        if (readContent !== undefined && !event.defaultPrevented) setIsEditing(false);
    };

    const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
        if (event.key !== 'Escape' || readContent === undefined) return;
        event.preventDefault();
        onCancelEdit?.();
        setIsEditing(false);
    };

    const editAction = canEdit && showsReadSurface ? (
        <button
            type="button"
            aria-label={'Edit ' + field.label}
            title={'Edit ' + field.label}
            onClick={() => setIsEditing(true)}
            className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-sage-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50 dark:text-zinc-500 dark:hover:bg-white/5 dark:hover:text-sage-300"
        >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
    ) : null;

    return (
        <div className={className}>
            <MetadataSectionHeader
                title={field.label}
                icon={Icon}
                iconClassName={field.iconClassName}
                labelFor={showsReadSurface ? undefined : textareaId}
                headingId={showsReadSurface ? textareaId + '-heading' : undefined}
                trailing={headerAction || source || editAction
                    ? <>{headerAction}{editAction}<MetadataSourceBadge source={source} /></>
                    : undefined}
                className="mb-2"
            />
            <div className="relative">
                {showsReadSurface ? (
                    <div
                        role="textbox"
                        tabIndex={0}
                        aria-readonly="true"
                        aria-multiline="true"
                        aria-labelledby={textareaId + '-heading'}
                        className={'w-full overflow-y-auto whitespace-pre-wrap break-words rounded-xl border p-3 font-sans text-sm text-gray-800 outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50 dark:text-zinc-200 ' + field.heightClassName + ' ' + field.textareaClassName + ' ' + dirtyClassName + (readOnly ? ' cursor-default opacity-80' : '')}
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
                        className={`w-full resize-none rounded-xl border p-3 font-sans text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 dark:text-zinc-200 ${field.heightClassName} ${field.textareaClassName} ${dirtyClassName} ${readOnly ? 'cursor-default opacity-80' : ''}`}
                    />
                )}
                {status}
                {!showsReadSurface ? overlay : null}
            </div>
        </div>
    );
};
