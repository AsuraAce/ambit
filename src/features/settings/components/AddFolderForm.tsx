import * as React from 'react';
import { Plus, FolderSearch } from 'lucide-react';
import { TooltipButton } from '../../../components/ui/InfoTooltip';

interface AddFolderFormProps {
    value: string;
    onChange: (val: string) => void;
    onBrowse: () => void;
    onSubmit: (e: React.FormEvent) => void;
    placeholder?: string;
}

export const AddFolderForm: React.FC<AddFolderFormProps> = ({
    value, onChange, onBrowse, onSubmit, placeholder
}) => {
    return (
        <form onSubmit={onSubmit} className="flex gap-2">
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder || "e.g. D:/StableDiffusion/outputs"}
                className="flex-1 bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-sage-500 outline-none text-gray-900 dark:text-white placeholder-gray-400"
            />
            <TooltipButton
                label="Browse for Folder"
                content="Browse for Folder"
                onClick={onBrowse}
                className="px-3 py-2 bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-white/20 transition-colors"
            >
                <FolderSearch className="w-4 h-4" />
            </TooltipButton>
            <button
                type="submit"
                disabled={!value.trim()}
                className="px-4 py-2 bg-sage-600 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg hover:bg-sage-500 transition-colors font-medium text-sm flex items-center gap-1"
            >
                <Plus className="w-4 h-4" /> Add
            </button>
        </form>
    );
};
