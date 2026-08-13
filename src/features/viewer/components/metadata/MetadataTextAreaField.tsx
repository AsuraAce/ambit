import * as React from 'react';
import { Code, FileText } from 'lucide-react';
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
}) => {
    const field = FIELD_PRESENTATION[kind];
    const Icon = field.icon;
    const textareaId = React.useId();
    const dirtyClassName = isDirty && kind !== 'notes'
        ? 'border-amber-300 bg-amber-50/10 dark:border-amber-500/50'
        : 'border-gray-200 dark:border-white/10';

    return (
        <div className={className}>
            <MetadataSectionHeader
                title={field.label}
                icon={Icon}
                iconClassName={field.iconClassName}
                labelFor={textareaId}
                trailing={headerAction || source
                    ? <>{headerAction}<MetadataSourceBadge source={source} /></>
                    : undefined}
                className="mb-2"
            />
            <div className="relative">
                <textarea
                    id={textareaId}
                    aria-label={field.label}
                    value={value}
                    onChange={onChange}
                    onBlur={onBlur}
                    readOnly={readOnly}
                    placeholder={field.placeholder}
                    className={`w-full resize-none rounded-xl border p-3 font-sans text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 dark:text-zinc-200 ${field.heightClassName} ${field.textareaClassName} ${dirtyClassName} ${readOnly ? 'cursor-default opacity-80' : ''}`}
                />
                {status}
                {overlay}
            </div>
        </div>
    );
};
