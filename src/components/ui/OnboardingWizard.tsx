import * as React from 'react';
import { useState } from 'react';
import { Sparkles, BrainCircuit, Shield, Key, Check, ArrowRight, Lock, EyeOff, ServerOff, FileJson, Aperture, Link2, Workflow, Palette, Image } from 'lucide-react';
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
    const [dontShowOnStartup, setDontShowOnStartup] = useState(true); // Default: checked = don't show again

    if (!isOpen) return null;

    const totalSteps = 4;
    const isEnvKey = !!process.env.API_KEY;

    const handleNext = () => {
        if (step < totalSteps) {
            setStep(step + 1);
        } else {
            // Finish
            onComplete({
                enableAI,
                googleGeminiApiKey: apiKey,
                maskedKeywords: blurNsfw ? ['nsfw', 'nude', 'naked', 'blood', 'gore', 'violence'] : [],
                maskingMode: 'blur',
                hasCompletedOnboarding: dontShowOnStartup // Only mark complete if checkbox is checked
            });
        }
    };

    const handleBack = () => {
        if (step > 1) setStep(step - 1);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-950/90 backdrop-blur-md animate-in fade-in duration-500">
            <div className="w-full max-w-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row h-[600px]">

                {/* Left Panel - Visuals */}
                <div className="w-full md:w-1/3 bg-gradient-to-br from-gray-900 to-sage-900 p-8 flex flex-col justify-between text-white relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-full bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none"></div>
                    <div className="relative z-10">
                        <div className="w-12 h-12 bg-white/10 backdrop-blur rounded-xl flex items-center justify-center mb-6 border border-white/20">
                            <Aperture className="w-6 h-6 text-sage-300" />
                        </div>
                        <h1 className="text-2xl font-bold leading-tight mb-2 tracking-tight">{APP_NAME}</h1>
                        <p className="text-sage-100/70 text-sm">Your professional workspace for generative art.</p>
                    </div>

                    <div className="relative z-10 space-y-4">
                        <StepIndicator current={step} step={1} label="Welcome" />
                        <StepIndicator current={step} step={2} label="Integrations" />
                        <StepIndicator current={step} step={3} label="Intelligence" />
                        <StepIndicator current={step} step={4} label="Privacy" />
                    </div>
                </div>

                {/* Right Panel - Content */}
                <div className="flex-1 p-8 md:p-10 flex flex-col">

                    {/* STEP 1: WELCOME */}
                    {step === 1 && (
                        <div className="flex-1 flex flex-col justify-center animate-in slide-in-from-right-4 duration-300">
                            <div className="mb-6">
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Scope Your Imagination.</h2>
                                <p className="text-gray-500 dark:text-gray-400 leading-relaxed">
                                    {APP_NAME} is a local-first organizer that unifies your workflow. It reads metadata directly from <strong>ComfyUI</strong>, <strong>Automatic1111</strong>, and <strong>InvokeAI</strong> images.
                                </p>
                            </div>

                            <div className="space-y-4">
                                <FeatureRow icon={<BrainCircuit className="w-5 h-5 text-sage-500" />} title="Smart Analysis" desc="Find 'cyberpunk cities' without tagging." />
                                <FeatureRow icon={<Lock className="w-5 h-5 text-sage-500" />} title="Local First" desc="Your images never leave your device." />
                            </div>
                        </div>
                    )}

                    {/* STEP 2: INTEGRATIONS (NEW) */}
                    {step === 2 && (
                        <div className="flex-1 flex flex-col animate-in slide-in-from-right-4 duration-300">
                            <div className="mb-6">
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Connect Your Generators</h2>
                                <p className="text-gray-500 dark:text-gray-400 text-sm">
                                    Import images with full metadata, favorites, and automatic syncing by connecting your AI image generators.
                                </p>
                            </div>

                            <div className="grid grid-cols-3 gap-3 mb-6">
                                <IntegrationCard
                                    icon={<Image className="w-6 h-6" />}
                                    title="InvokeAI"
                                    features={["Boards", "Favorites", "Live sync"]}
                                    color="indigo"
                                    onSetup={() => onOpenSettings?.('invokeai')}
                                />
                                <IntegrationCard
                                    icon={<Workflow className="w-6 h-6" />}
                                    title="ComfyUI"
                                    features={["Workflows", "Node data"]}
                                    color="emerald"
                                    onSetup={() => onOpenSettings?.('comfyui')}
                                />
                                <IntegrationCard
                                    icon={<Palette className="w-6 h-6" />}
                                    title="A1111 / Forge"
                                    features={["Outputs", "Metadata"]}
                                    color="amber"
                                    onSetup={() => onOpenSettings?.('a1111')}
                                />
                            </div>

                            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                                    <strong className="text-gray-700 dark:text-gray-300">Why integrations?</strong> Direct integration with your generators means richer metadata, automatic syncing of favorites and boards, and real-time updates when you create new images.
                                </p>
                            </div>

                            <p className="text-xs text-gray-400 mt-4 text-center">
                                You can also set these up later in <strong>Settings</strong>.
                            </p>
                        </div>
                    )}

                    {/* STEP 3: AI SETUP */}
                    {step === 3 && (
                        <div className="flex-1 flex flex-col justify-center animate-in slide-in-from-right-4 duration-300">
                            <div className="mb-6">
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Activate Intelligence</h2>
                                <p className="text-gray-500 dark:text-gray-400 text-sm">
                                    Enable Google Gemini to analyze prompts, recover metadata, and use natural language search.
                                </p>
                            </div>

                            <label className="flex items-center gap-3 p-4 border border-gray-200 dark:border-gray-700 rounded-xl cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors mb-6">
                                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${enableAI ? 'bg-sage-600 border-sage-600' : 'border-gray-400'}`}>
                                    {enableAI && <Check className="w-3.5 h-3.5 text-white" />}
                                </div>
                                <input type="checkbox" className="hidden" checked={enableAI} onChange={() => setEnableAI(!enableAI)} />
                                <span className="font-medium text-gray-900 dark:text-white">Enable AI Features</span>
                            </label>

                            {enableAI && (
                                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                                    <div className="flex justify-between">
                                        <label className="text-xs font-bold text-gray-500 uppercase">Gemini API Key</label>
                                        <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-xs text-sage-500 hover:underline">Get Free Key &rarr;</a>
                                    </div>

                                    {isEnvKey ? (
                                        <div className="flex items-center gap-2 p-3 bg-green-100 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-300">
                                            <Key className="w-4 h-4" />
                                            <span>Pre-configured via Environment</span>
                                        </div>
                                    ) : (
                                        <input
                                            type="password"
                                            placeholder="Paste your API Key here..."
                                            value={apiKey}
                                            onChange={(e) => setApiKey(e.target.value)}
                                            className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-3 text-sm focus:border-sage-500 outline-none dark:text-white"
                                        />
                                    )}
                                    <p className="text-xs text-gray-400 mt-1">Your key is stored locally in your browser.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* STEP 4: PRIVACY */}
                    {step === 4 && (
                        <div className="flex-1 flex flex-col justify-center animate-in slide-in-from-right-4 duration-300">
                            <div className="mb-6">
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Privacy & Safety</h2>
                                <div className="space-y-3 mb-6">
                                    <div className="flex items-start gap-3">
                                        <ServerOff className="w-5 h-5 text-gray-400 mt-0.5" />
                                        <p className="text-sm text-gray-600 dark:text-gray-300">
                                            <strong>Local Processing:</strong> Your images are processed in your browser memory. We do not upload your files to any server.
                                        </p>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <FileJson className="w-5 h-5 text-sage-400 mt-0.5" />
                                        <p className="text-sm text-gray-600 dark:text-gray-300">
                                            <strong>AI Data:</strong> Only text metadata is sent to Google Gemini for search analysis. Images are only sent if you explicitly use "Recover Metadata".
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="p-5 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
                                <div className="flex items-start gap-4">
                                    <div className="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
                                        <EyeOff className="w-6 h-6 text-gray-600 dark:text-gray-400" />
                                    </div>
                                    <div className="flex-1">
                                        <h4 className="font-bold text-gray-900 dark:text-white">Content Masking</h4>
                                        <p className="text-xs text-gray-500 mt-1">
                                            Automatically blur images that contain keywords like 'nsfw', 'gore', or 'spoilers' in their prompt.
                                        </p>
                                    </div>
                                    {/* Toggle Switch */}
                                    <div
                                        className={`w-12 h-6 rounded-full relative transition-colors cursor-pointer ${blurNsfw ? 'bg-sage-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                                        onClick={() => setBlurNsfw(!blurNsfw)}
                                    >
                                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${blurNsfw ? 'left-7' : 'left-1'}`} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Footer Controls */}
                    <div className="flex items-center justify-between pt-6 border-t border-gray-100 dark:border-gray-800">
                        <div className="flex items-center gap-4">
                            <div className="flex gap-1">
                                {[1, 2, 3, 4].map(i => (
                                    <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-8 bg-sage-600' : 'w-2 bg-gray-200 dark:bg-gray-700'}`} />
                                ))}
                            </div>

                            {step === totalSteps && (
                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                    <div
                                        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${dontShowOnStartup ? 'bg-sage-600 border-sage-600' : 'border-gray-400'}`}
                                        onClick={() => setDontShowOnStartup(!dontShowOnStartup)}
                                    >
                                        {dontShowOnStartup && <Check className="w-3 h-3 text-white" />}
                                    </div>
                                    <span className="text-xs text-gray-500 dark:text-gray-400">Don't show on startup</span>
                                </label>
                            )}
                        </div>

                        <div className="flex gap-2">
                            {step > 1 && (
                                <button
                                    onClick={handleBack}
                                    className="px-4 py-3 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-xl font-medium text-sm transition-colors"
                                >
                                    Back
                                </button>
                            )}
                            <button
                                onClick={handleNext}
                                className="px-6 py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-xl font-bold text-sm hover:opacity-90 transition-opacity flex items-center gap-2"
                            >
                                {step === totalSteps ? "Get Started" : "Next Step"}
                                <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const StepIndicator = ({ current, step, label }: { current: number, step: number, label: string }) => (
    <div className={`flex items-center gap-3 transition-opacity duration-300 ${current === step ? 'opacity-100' : 'opacity-50'}`}>
        <div className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs font-bold ${current >= step ? 'bg-white text-sage-600 border-white' : 'border-sage-300 text-sage-200'}`}>
            {current > step ? <Check className="w-3.5 h-3.5" /> : step}
        </div>
        <span className="font-medium">{label}</span>
    </div>
);

const FeatureRow = ({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) => (
    <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
        <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
            {icon}
        </div>
        <div>
            <div className="font-bold text-sm text-gray-900 dark:text-white">{title}</div>
            <div className="text-xs text-gray-500">{desc}</div>
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
    const colorClasses = {
        indigo: 'border-indigo-200 dark:border-indigo-500/30 hover:bg-indigo-50 dark:hover:bg-indigo-500/10',
        emerald: 'border-emerald-200 dark:border-emerald-500/30 hover:bg-emerald-50 dark:hover:bg-emerald-500/10',
        amber: 'border-amber-200 dark:border-amber-500/30 hover:bg-amber-50 dark:hover:bg-amber-500/10'
    };

    const iconColors = {
        indigo: 'text-indigo-500',
        emerald: 'text-emerald-500',
        amber: 'text-amber-500'
    };

    return (
        <div className={`p-4 border rounded-xl transition-colors ${colorClasses[color]} cursor-pointer group`} onClick={onSetup}>
            <div className={`${iconColors[color]} mb-3`}>{icon}</div>
            <div className="font-bold text-sm text-gray-900 dark:text-white mb-2">{title}</div>
            <ul className="space-y-1 mb-3">
                {features.map((f, i) => (
                    <li key={i} className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <Check className="w-2.5 h-2.5 text-gray-400" />{f}
                    </li>
                ))}
            </ul>
            <div className={`text-xs font-bold ${iconColors[color]} opacity-0 group-hover:opacity-100 transition-opacity`}>
                Set Up →
            </div>
        </div>
    );
};
