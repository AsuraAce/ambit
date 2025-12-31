import { FilterState } from '../types';

/**
 * Parses a search term (e.g. "lora:name", "model:name") and updates the filter state.
 * If no prefix is found, it updates the searchQuery.
 */
export const parseAndApplyFilter = (
    term: string,
    setFilters: (update: (prev: FilterState) => FilterState) => void
) => {
    if (!term) return;

    if (term.startsWith('lora:')) {
        const loraName = term.replace('lora:', '').trim();
        if (loraName) {
            setFilters(prev => ({
                ...prev,
                loras: prev.loras.includes(loraName) ? prev.loras : [...prev.loras, loraName]
            }));
        }
    } else if (term.startsWith('model:')) {
        const modelName = term.replace('model:', '').trim();
        if (modelName) {
            setFilters(prev => ({
                ...prev,
                models: prev.models.includes(modelName) ? prev.models : [...prev.models, modelName]
            }));
        }
    } else if (term.startsWith('tool:')) {
        const toolName = term.replace('tool:', '').trim();
        // Re-calculating enum if needed, but for now we trust the text matching in SQL
        setFilters(prev => ({
            ...prev,
            searchQuery: prev.searchQuery ? `${prev.searchQuery} ${term}` : term
        }));
    } else {
        // Default to search query or check if it's a known smart tag
        setFilters(prev => ({
            ...prev,
            searchQuery: term
        }));
    }
};
