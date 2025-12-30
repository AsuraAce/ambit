
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
    }
  };

  const submitSearch = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setFilters(f => ({ ...f, searchQuery: trimmed }));
    setRecentSearches(prev => [trimmed, ...prev.filter(s => s !== trimmed)].slice(0, 8));
    inputRef.current?.blur();

    if (isAiSearchEnabled && settings.enableAI) {
      const apiKey = settings.googleGeminiApiKey || process.env.API_KEY;
      setIsSearchingAi(true);
      addToast("Gemini is analyzing your request...", "info");
      try {
        const aiFilters = await generateFiltersFromQuery(trimmed, apiKey!);
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
    isAiSearchEnabled: isAiSearchEnabled && settings.enableAI,
    isSearchingAi,
    inputRef,
    toggleAiSearch,
    submitSearch
  };
};
