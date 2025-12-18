
import { useState } from 'react';
import { analyzePromptAndSuggest, generatePromptVariations } from '../services/geminiService';

export const useImageAI = (apiKey?: string, enableAI?: boolean) => {
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
        console.error(e);
        // Error handling usually done via toast in UI layer or thrown
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
        console.error(e);
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
