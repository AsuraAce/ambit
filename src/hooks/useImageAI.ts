
import { useState } from 'react';
import { analyzePromptAndSuggest, generatePromptVariations } from '../services/geminiService';

/**
 * Parses a Gemini API error into a user-friendly message.
 */
function parseGeminiError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  const lowerMsg = msg.toLowerCase();

  if (lowerMsg.includes('quota') || lowerMsg.includes('resource exhausted') || lowerMsg.includes('429')) {
    return 'AI quota exceeded. Please try again later.';
  }
  if (lowerMsg.includes('rate') || lowerMsg.includes('too many requests')) {
    return 'Too many requests. Please wait a moment.';
  }
  if (lowerMsg.includes('api key') || lowerMsg.includes('invalid') || lowerMsg.includes('401') || lowerMsg.includes('403')) {
    return 'Invalid API key. Check your settings.';
  }
  if (lowerMsg.includes('network') || lowerMsg.includes('fetch') || lowerMsg.includes('failed to fetch')) {
    return 'Network error. Check your connection.';
  }
  if (lowerMsg.includes('no api key') || lowerMsg.includes('missing')) {
    return 'API key is missing. Add it in Settings > Experiments.';
  }

  return 'AI request failed. Please try again.';
}

interface UseImageAIOptions {
  apiKey?: string;
  enableAI?: boolean;
  onError?: (message: string) => void;
}

export const useImageAI = ({ apiKey, enableAI, onError }: UseImageAIOptions) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'analysis' | 'variations'>('analysis');
  const [result, setResult] = useState<string | string[] | null>(null);

  const analyzePrompt = async (prompt: string, onOpenSettings: () => void) => {
    if (!enableAI || !apiKey) {
      onOpenSettings();
      return;
    }

    setIsAnalyzing(true);
    try {
      const insight = await analyzePromptAndSuggest(prompt, apiKey);
      setResult(insight);
      setModalType('analysis');
      setModalOpen(true);
    } catch (e) {
      console.error('AI Analysis Error:', e);
      onError?.(parseGeminiError(e));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const generateVariations = async (prompt: string, onOpenSettings: () => void) => {
    if (!enableAI || !apiKey) {
      onOpenSettings();
      return;
    }

    setIsAnalyzing(true);
    try {
      const vars = await generatePromptVariations(prompt, apiKey);
      setResult(vars);
      setModalType('variations');
      setModalOpen(true);
    } catch (e) {
      console.error('AI Variations Error:', e);
      onError?.(parseGeminiError(e));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const closeModal = () => setModalOpen(false);
  const openModal = () => {
    if (result) setModalOpen(true);
  };

  return {
    isAnalyzing,
    modalOpen,
    modalType,
    result,
    analyzePrompt,
    generateVariations,
    closeModal,
    openModal
  };
};
