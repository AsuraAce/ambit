import * as React from 'react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, BrainCircuit, Shield, Key, Check, ArrowRight, Lock, EyeOff, ServerOff, FileJson, Aperture, Link2, Workflow, Palette, Image, ChevronRight, Zap } from 'lucide-react';
import { AppSettings } from '../../types';
import { APP_NAME } from '../../constants/app';

interface OnboardingWizardProps {
    isOpen: boolean;
    onComplete: (settings: Partial<AppSettings>) => void;
    onOpenSettings?: (tab: 'invokeai' | 'comfyui' | 'a1111') => void;
    initialApiKey?: string;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
    isOpen,
    onComplete,
    onOpenSettings,
    initialApiKey
}) => {
    const [step, setStep] = useState(1);
    const [apiKey, setApiKey] = useState(initialApiKey || '');
    const [enableAI, setEnableAI] = useState(!!initialApiKey);
    const [blurNsfw, setBlurNsfw] = useState(true);
    const [dontShowOnStartup, setDontShowOnStartup] = useState(true);

    if (!isOpen) return null;

    const totalSteps = 4;
    const isEnvKey = !!process.env.API_KEY;

    const handleNext = () => {
        if (step < totalSteps) {
            setStep(step + 1);
        } else {
            onComplete({
                enableAI,
                googleGeminiApiKey: apiKey,
                maskedKeywords: blurNsfw ? ['nsfw', 'nude', 'naked', 'blood', 'gore', 'violence'] : [],
                maskingMode: 'blur',
                hasCompletedOnboarding: dontShowOnStartup
            });
        }
    };

    const handleBack = () => {
        if (step > 1) setStep(step - 1);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-950/90 backdrop-blur-md">
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="w-full max-w-4xl bg-white dark:bg-[#0c0c0e] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row h-[680px]"
            >

                {/* Left Panel - Visuals */}
                <div className="w-full md:w-1/3 bg-gradient-to-br from-zinc-900 via-zinc-900 to-sage-900/40 p-10 flex flex-col justify-between text-white relative overflow-hidden">
                    {/* Noise & Mesh Gradient */}
                    <div className="absolute inset-0 opacity-20 mix-blend-overlay pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>
                    <div className="absolute -top-20 -left-20 w-64 h-64 bg-sage-500/10 rounded-full blur-[100px] pointer-events-none"></div>

                    <div className="relative z-10">
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="w-14 h-14 bg-white/5 backdrop-blur-xl rounded-2xl flex items-center justify-center mb-8 border border-white/10 shadow-xl"
                        >
                            <Aperture className="w-8 h-8 text-sage-400" />
                        </motion.div>
                        <h1 className="text-3xl font-bold leading-tight mb-2 tracking-tight bg-gradient-to-br from-white to-white/60 bg-clip-text text-transparent">{APP_NAME}</h1>
                        <p className="text-sage-100/50 text-sm leading-relaxed">Your professional local first generative art studio.</p>
                    </div>

                    <div className="relative z-10 space-y-4">
                        <StepIndicator current={step} step={1} label="Welcome" />
                        <StepIndicator current={step} step={2} label="Integrations" />
                        <StepIndicator current={step} step={3} label="Intelligence" />
                        <StepIndicator current={step} step={4} label="Privacy" />
                    </div>
                </div>

                {/* Right Panel - Content */}
                <div className="flex-1 p-8 md:p-10 flex flex-col relative bg-transparent overflow-hidden">
                    {/* Decorative Background Glow for Content */}
                    <div className="absolute top-0 right-0 w-64 h-64 bg-sage-500/5 rounded-full blur-[100px] pointer-events-none"></div>

                    <AnimatePresence mode="wait">
                        <motion.div
                            key={step}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.3, ease: "easeOut" }}
                            className="flex-1 flex flex-col"
                        >
                            {/* STEP 1: WELCOME */}
                            {step === 1 && (
                                <div className="flex-1 flex flex-col">
                                    <div className="mb-6">
                                        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4 tracking-tight">Scope Your Imagination.</h2>
                                        <p className="text-gray-500 dark:text-gray-400 leading-relaxed text-lg">
                                            {APP_NAME} unifies your local AI workflow. Organize your creations from <strong>ComfyUI</strong>, <strong>Forge</strong>, and <strong>InvokeAI</strong> in one place.
                                        </p>
                                    </div>

                                    <div className="space-y-4">
                                        <FeatureRow icon={<BrainCircuit className="w-6 h-6 text-sage-400" />} title="Semantic Discovery" desc="Search by content, style, or feeling—not just tags." />
                                        <FeatureRow icon={<Zap className="w-6 h-6 text-sage-400" />} title="Full Metadata" desc="View prompts, samplers, and node parameters instantly." />
                                        <FeatureRow icon={<Lock className="w-6 h-6 text-sage-400" />} title="Extreme Privacy" desc="Local processing. Your images never leave your machine." />
                                    </div>
                                </div>
                            )}

                            {/* STEP 2: INTEGRATIONS */}
                            {step === 2 && (
                                <div className="flex-1 flex flex-col">
                                    <div className="mb-6">
                                        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-3 tracking-tight">Connect Generators</h2>
                                        <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed max-w-md">
                                            Enable automatic syncing of outputs, favorites, and boards by linking your existing backends.
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-6">
                                        <IntegrationCard
                                            icon={<Image className="w-6 h-6" />}
                                            title="InvokeAI"
                                            features={["Boards", "Live sync"]}
                                            color="indigo"
                                            onSetup={() => onOpenSettings?.('invokeai')}
                                        />
                                        <IntegrationCard
                                            icon={<Workflow className="w-6 h-6" />}
                                            title="ComfyUI"
                                            features={["Workflows", "Metadata"]}
                                            color="emerald"
                                            onSetup={() => onOpenSettings?.('comfyui')}
                                        />
                                        <IntegrationCard
                                            icon={<Palette className="w-6 h-6" />}
                                            title="A1111 / Forge"
                                            features={["Outputs", "Legacy"]}
                                            color="amber"
                                            onSetup={() => onOpenSettings?.('a1111')}
                                        />
                                    </div>

                                    <div className="bg-sage-500/5 dark:bg-white/5 rounded-2xl p-5 border border-sage-500/10 dark:border-white/10 backdrop-blur-sm">
                                        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                                            <strong className="text-sage-600 dark:text-sage-400">Why connect?</strong> Integrations allow Ambit to watch your output folders in real-time, syncing your favorites and board organization automatically.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* STEP 3: AI SETUP */}
                            {step === 3 && (
                                <div className="flex-1 flex flex-col">
                                    <div className="mb-6">
                                        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-3 tracking-tight">Activate AI Insights</h2>
                                        <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">
                                            Power natural language search and complex metadata analysis using Google Gemini.
                                        </p>
                                    </div>

                                    <motion.label
                                        whileHover={{ backgroundColor: 'rgba(139, 174, 124, 0.1)' }}
                                        className={`flex items-center gap-4 p-5 border rounded-2xl cursor-pointer transition-all duration-300 mb-6 ${enableAI ? 'border-sage-500/50 bg-sage-500/5' : 'border-gray-200 dark:border-white/10'}`}
                                    >
                                        <div className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-all ${enableAI ? 'bg-sage-500 border-sage-500 shadow-lg shadow-sage-500/20' : 'border-gray-400'}`}>
                                            {enableAI && <Check className="w-4 h-4 text-white" />}
                                        </div>
                                        <input type="checkbox" className="hidden" checked={enableAI} onChange={() => setEnableAI(!enableAI)} />
                                        <div className="flex-1">
                                            <span className="font-bold text-gray-900 dark:text-white block">Enable Intelligence Features</span>
                                            <span className="text-xs text-gray-500">Analysis, search enrichment, and tags.</span>
                                        </div>
                                    </motion.label>

                                    {enableAI && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="space-y-4"
                                        >
                                            <div className="flex justify-between items-end">
                                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Gemini API Key</label>
                                                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-xs text-sage-500 hover:text-sage-400 font-bold flex items-center gap-1 transition-colors">
                                                    Get Free Key <ChevronRight className="w-3 h-3" />
                                                </a>
                                            </div>

                                            {isEnvKey ? (
                                                <div className="flex items-center gap-3 p-4 bg-sage-500/10 border border-sage-500/20 rounded-xl text-sm text-sage-700 dark:text-sage-300">
                                                    <Key className="w-5 h-5 text-sage-500" />
                                                    <span className="font-medium">Detected Key in Environment</span>
                                                </div>
                                            ) : (
                                                <div className="relative group">
                                                    <input
                                                        type="password"
                                                        placeholder="Paste your API Key here..."
                                                        value={apiKey}
                                                        onChange={(e) => setApiKey(e.target.value)}
                                                        className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-4 py-4 text-sm focus:border-sage-500/50 focus:ring-4 focus:ring-sage-500/5 outline-none dark:text-white transition-all"
                                                    />
                                                </div>
                                            )}
                                        </motion.div>
                                    )}
                                </div>
                            )}

                            {/* STEP 4: PRIVACY */}
                            {step === 4 && (
                                <div className="flex-1 flex flex-col">
                                    <div className="mb-6">
                                        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4 tracking-tight">Privacy & Safety</h2>
                                        <div className="space-y-4 mb-6">
                                            <div className="flex items-start gap-4 p-4 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/5">
                                                <ServerOff className="w-6 h-6 text-sage-500 mt-1" />
                                                <div className="flex-1">
                                                    <h4 className="font-bold text-sm text-gray-900 dark:text-white">Local-First Architecture</h4>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                                                        Images are indexed and stored on your hardware. No telemetry, no cloud uploads, no tracking.
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-start gap-4 p-4 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/5">
                                                <FileJson className="w-6 h-6 text-sage-500 mt-1" />
                                                <div className="flex-1">
                                                    <h4 className="font-bold text-sm text-gray-900 dark:text-white">AI Data Sovereignty</h4>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                                                        If enabled, only metadata strings are sent to Gemini for vector analysis. You remain in control.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-6 bg-gradient-to-br from-sage-500/10 to-transparent dark:from-white/5 dark:to-transparent rounded-2xl border border-sage-500/10 dark:border-white/10">
                                        <div className="flex items-center gap-5">
                                            <div className="p-3 bg-white dark:bg-zinc-800 rounded-xl shadow-lg border border-gray-100 dark:border-white/5 flex-shrink-0">
                                                <EyeOff className="w-8 h-8 text-sage-500" />
                                            </div>
                                            <div className="flex-1">
                                                <h4 className="font-bold text-gray-900 dark:text-white">Safety Masking</h4>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                                                    Automatically blur content containing sensitive keywords in prompts. Best for shared workspaces.
                                                </p>
                                            </div>
                                            <div
                                                className={`w-14 h-7 rounded-full relative transition-all duration-300 cursor-pointer shadow-inner flex-shrink-0 ${blurNsfw ? 'bg-sage-500' : 'bg-gray-300 dark:bg-zinc-700'}`}
                                                onClick={() => setBlurNsfw(!blurNsfw)}
                                            >
                                                <motion.div
                                                    animate={{ x: blurNsfw ? 28 : 4 }}
                                                    className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-lg"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    </AnimatePresence>

                    {/* Footer Controls */}
                    <div className="flex items-center justify-between pt-10 mt-auto">
                        <div className="flex items-center gap-6">
                            <div className="flex gap-1.5">
                                {[1, 2, 3, 4].map(i => (
                                    <div key={i} className={`h-1.5 rounded-full transition-all duration-500 ${i === step ? 'w-10 bg-sage-500' : 'w-2 bg-gray-200 dark:bg-white/10'}`} />
                                ))}
                            </div>

                            {step === totalSteps && (
                                <motion.label
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="flex items-center gap-2 cursor-pointer select-none group"
                                >
                                    <div
                                        className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${dontShowOnStartup ? 'bg-sage-600 border-sage-600 shadow-lg shadow-sage-500/20' : 'border-gray-400 group-hover:border-sage-400'}`}
                                        onClick={() => setDontShowOnStartup(!dontShowOnStartup)}
                                    >
                                        {dontShowOnStartup && <Check className="w-3 h-3 text-white" />}
                                    </div>
                                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 group-hover:text-gray-300 transition-colors whitespace-nowrap">Start on Every Boot</span>
                                </motion.label>
                            )}
                        </div>

                        <div className="flex gap-4">
                            {step > 1 && (
                                <button
                                    onClick={handleBack}
                                    className="px-6 py-4 text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-xl font-bold text-sm transition-all hover:bg-gray-50 dark:hover:bg-white/5 active:scale-95"
                                >
                                    Back
                                </button>
                            )}
                            <button
                                onClick={handleNext}
                                className="px-6 py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-2xl font-black text-sm hover:translate-y-[-2px] hover:shadow-xl active:translate-y-0 active:scale-95 transition-all flex items-center gap-3 shadow-lg dark:shadow-white/5 whitespace-nowrap"
                            >
                                {step === totalSteps ? "Launch Ambit" : "Next Step"}
                                <ArrowRight className="w-5 h-5 stroke-[2.5]" />
                            </button>
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

const StepIndicator = ({ current, step, label }: { current: number, step: number, label: string }) => {
    const active = current === step;
    const completed = current > step;

    return (
        <div className={`flex items-center gap-4 transition-all duration-500 ${active ? 'opacity-100 translate-x-1' : 'opacity-40 hover:opacity-100'}`}>
            <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-black transition-all duration-500 shadow-sm ${active ? 'bg-white text-zinc-900 border-white scale-110 shadow-lg shadow-white/20' : completed ? 'bg-sage-500 border-sage-500 text-white' : 'border-white/20 text-white'}`}>
                {completed ? <Check className="w-4 h-4 stroke-[3]" /> : step}
            </div>
            <span className={`text-sm tracking-wide transition-all ${active ? 'font-black' : 'font-medium'}`}>{label}</span>
        </div>
    );
};

const FeatureRow = ({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) => (
    <div className="flex items-center gap-5 p-4 rounded-2xl hover:bg-sage-500/5 dark:hover:bg-white/5 border border-transparent hover:border-sage-500/10 dark:hover:border-white/10 transition-all duration-300 group">
        <div className="w-12 h-12 bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-xl shadow-md flex items-center justify-center group-hover:scale-110 group-hover:bg-sage-500 group-hover:text-white transition-all duration-300">
            {icon}
        </div>
        <div>
            <div className="font-black text-sm text-gray-900 dark:text-white tracking-tight">{title}</div>
            <div className="text-xs text-gray-500 dark:text-sage-100/40 font-medium leading-relaxed">{desc}</div>
        </div>
    </div>
);

interface IntegrationCardProps {
    icon: React.ReactNode;
    title: string;
    features: string[];
    color: 'indigo' | 'emerald' | 'amber';
    onSetup?: () => void;
}

const IntegrationCard: React.FC<IntegrationCardProps> = ({ icon, title, features, color, onSetup }) => {
    const colors = {
        indigo: {
            bg: 'hover:bg-indigo-500/5',
            border: 'hover:border-indigo-500/30',
            glow: 'group-hover:shadow-[0_0_20px_rgba(99,102,241,0.15)]',
            icon: 'bg-indigo-500/10 text-indigo-500',
            dots: 'text-indigo-400',
            text: 'text-indigo-500'
        },
        emerald: {
            bg: 'hover:bg-emerald-500/5',
            border: 'hover:border-emerald-500/30',
            glow: 'group-hover:shadow-[0_0_20px_rgba(16,185,129,0.15)]',
            icon: 'bg-emerald-500/10 text-emerald-500',
            dots: 'text-emerald-400',
            text: 'text-emerald-500'
        },
        amber: {
            bg: 'hover:bg-amber-500/5',
            border: 'hover:border-amber-500/30',
            glow: 'group-hover:shadow-[0_0_20px_rgba(245,158,11,0.15)]',
            icon: 'bg-amber-500/10 text-amber-500',
            dots: 'text-amber-400',
            text: 'text-amber-500'
        }
    }[color];

    return (
        <motion.div
            whileHover={{ y: -4 }}
            className={`p-6 border border-gray-100 dark:border-white/10 rounded-2xl transition-all duration-300 cursor-pointer bg-white dark:bg-white/[0.02] group ${colors.bg} ${colors.border} ${colors.glow}`}
            onClick={onSetup}
        >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-6 shadow-sm transition-transform duration-500 group-hover:scale-110 ${colors.icon}`}>
                {icon}
            </div>
            <div className="font-black text-sm text-gray-900 dark:text-white mb-4 tracking-tight">{title}</div>
            <ul className="space-y-2 mb-6">
                {features.map((f, i) => (
                    <li key={i} className="text-[10px] uppercase font-bold tracking-widest text-gray-400 dark:text-gray-500 flex items-center gap-2">
                        <div className={`w-1 h-1 rounded-full ${colors.dots} opacity-60`} /> {f}
                    </li>
                ))}
            </ul>
            <div className={`text-[11px] font-black uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0 ${colors.text}`}>
                Connect →
            </div>
        </motion.div>
    );
};
