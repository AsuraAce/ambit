
import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { FilterState, AppSettings } from '../types';
import { generateFiltersFromQuery } from '../services/geminiService';
import { useToast } from './useToast';

interface UseSearchProps {
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  settings: AppSettings;
  setRecentSearches: React.Dispatch<React.SetStateAction<string[]>>;
  availableTags: string[];
  onOpenSettings: () => void;
}

export const useSearch = ({
  filters,
  setFilters,
  settings,
  setRecentSearches,
  availableTags,
  onOpenSettings
}: UseSearchProps) => {
  const { addToast } = useToast();
  const [isAiSearchEnabled, setIsAiSearchEnabled] = useState(false);
  const [isSearchingAi, setIsSearchingAi] = useState(false);
  const [pendingAiActivation, setPendingAiActivation] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);

  // Sync state: If global setting is disabled, force local state off immediately
  useEffect(() => {
    if (!settings.enableAI) {
      setIsAiSearchEnabled(false);
    }
  }, [settings.enableAI]);

  // Sync state: Clear suggestions if searchQuery is empty (handled externally like clear button)
  useEffect(() => {
    if (!filters.searchQuery) {
      setSuggestions([]);
      setActiveSuggestionIndex(-1);
    }
  }, [filters.searchQuery]);

  useEffect(() => {
    if (pendingAiActivation && settings.enableAI) {
      setIsAiSearchEnabled(true);
      setPendingAiActivation(false);
      setTimeout(() => inputRef.current?.focus(), 100);
      addToast("AI Features Enabled & Ready", "success");
    }
  }, [settings.enableAI, pendingAiActivation, addToast]);

  const toggleAiSearch = () => {
    if (!settings.enableAI) {
      setPendingAiActivation(true);
      onOpenSettings();
      addToast("Enable AI features to use Natural Language Search.", "info");
      return;
    }

    // Toggle state
    setIsAiSearchEnabled(prev => !prev);

    // UI behavior on toggle
    if (!isAiSearchEnabled) {
      // Turning ON
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      // Turning OFF
      setSuggestions([]);
    }
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setFilters(prev => ({ ...prev, searchQuery: val }));
    setActiveSuggestionIndex(-1);

    // Autocomplete Logic
    const lastToken = val.split(' ').pop()?.toLowerCase() || '';
    if (lastToken.length >= 1) {
      const operators = ['model:', 'tool:', 'steps:', 'cfg:', 'seed:', 'neg:', 'sampler:', 'lora:', 'w:', 'h:', 'upscaled:'];
      const opMatches = operators.filter(op => op.startsWith(lastToken) && op !== lastToken);
      const tagMatches = availableTags.filter(t => t.toLowerCase().startsWith(lastToken) && t.toLowerCase() !== lastToken).slice(0, 8);
      setSuggestions([...opMatches, ...tagMatches]);
    } else {
      setSuggestions([]);
    }
  };

  const selectSuggestion = (index: number) => {
    if (index < 0 || index >= suggestions.length) return;

    const s = suggestions[index];
    const current = filters.searchQuery;
    const lastSpace = current.lastIndexOf(' ');
    const prefix = lastSpace >= 0 ? current.substring(0, lastSpace + 1) : '';

    setFilters(f => ({ ...f, searchQuery: prefix + s + ' ' }));
    // Suggestions will be cleared by the effect above
  };

  const clearSearch = () => {
    setFilters(f => ({ ...f, searchQuery: '' }));
    setSuggestions([]);
    setActiveSuggestionIndex(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length === 0) {
      if (e.key === 'Enter') submitSearch();
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveSuggestionIndex(prev => (prev + 1) % suggestions.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
        break;
      case 'Enter':
      case 'Tab':
        if (activeSuggestionIndex >= 0) {
          e.preventDefault();
          selectSuggestion(activeSuggestionIndex);
        } else if (e.key === 'Enter') {
          submitSearch();
        }
        break;
      case 'Escape':
        setSuggestions([]);
        setActiveSuggestionIndex(-1);
        inputRef.current?.blur();
        break;
    }
  };

  const submitSearch = async () => {
    const query = filters.searchQuery.trim();
    if (!query) return;

    setRecentSearches(prev => [query, ...prev.filter(s => s !== query)].slice(0, 8));
    inputRef.current?.blur();
    setSuggestions([]);

    if (isAiSearchEnabled && settings.enableAI) {
      const apiKey = settings.googleGeminiApiKey || process.env.API_KEY;
      setIsSearchingAi(true);
      addToast("Gemini is analyzing your request...", "info");
      try {
        const aiFilters = await generateFiltersFromQuery(query, apiKey!);
        setFilters(prev => ({
          ...prev,
          searchQuery: aiFilters.searchQuery || '',
          models: aiFilters.models || [],
          tools: aiFilters.tools || [],
          dateRange: aiFilters.dateRange || 'all',
          favoritesOnly: aiFilters.favoritesOnly || false,
        }));
        addToast("Filters updated by AI", "success");
      } catch (error) {
        addToast("AI Search failed. Check API Key.", "error");
      } finally {
        setIsSearchingAi(false);
      }
    }
  };

  return {
    isAiSearchEnabled: isAiSearchEnabled && settings.enableAI, // Double check
    isSearchingAi,
    suggestions,
    activeSuggestionIndex,
    setSuggestions,
    inputRef,
    toggleAiSearch,
    handleSearchChange,
    handleKeyDown,
    submitSearch,
    selectSuggestion,
    clearSearch
  };
};
