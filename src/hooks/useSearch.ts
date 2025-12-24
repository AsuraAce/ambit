
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

  const inputRef = useRef<HTMLInputElement>(null);

  // Sync state: If global setting is disabled, force local state off immediately
  useEffect(() => {
    if (!settings.enableAI) {
      setIsAiSearchEnabled(false);
    }
  }, [settings.enableAI]);

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
    setSuggestions,
    inputRef,
    toggleAiSearch,
    handleSearchChange,
    submitSearch
  };
};
