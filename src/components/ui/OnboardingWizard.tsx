import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    ArrowRight,
    BrainCircuit,
    Check,
    EyeOff,
    FileJson,
    FolderOpen,
    History,
    Image,
    Link2,
    Lock,
    Palette,
    Search,
    ServerOff,
    Wand2,
    Workflow,
} from 'lucide-react';
import { AppSettings } from '../../types';
import { APP_NAME } from '../../constants/app';
import { DEFAULT_APP_SETTINGS } from '../../constants/defaultSettings';
import { useToast } from '../../hooks/useToast';
import { useSettingsStore } from '../../stores/settingsStore';
import { ApiKeyInput } from './ApiKeyInput';

type OnboardingSettingsTab = 'folders' | 'invokeai' | 'comfyui' | 'a1111';

interface OnboardingWizardProps {
    isOpen: boolean;
    preserveBackdropWhenClosed?: boolean;
    onComplete: (settings: Partial<AppSettings>) => void;
    onOpenSettings?: (tab: OnboardingSettingsTab) => void;
}

const TOTAL_STEPS = 4;
const STEP_LABELS = ['Welcome', 'Integrations', 'Intelligence', 'Privacy'] as const;
const ONBOARDING_BACKDROP_CLASS = 'fixed inset-0 z-[100] bg-gray-950/90 backdrop-blur-md';
const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
    isOpen,
    preserveBackdropWhenClosed = false,
    onComplete,
    onOpenSettings,
}) => {
    const brandGlyphSrc = '/branding/ambit-glyph.svg';
    const settings = useSettingsStore(state => state.settings);
    const geminiApiKey = useSettingsStore(state => state.geminiApiKey);
    const setGeminiApiKey = useSettingsStore(state => state.setGeminiApiKey);
    const isEnvKey = !!process.env.API_KEY;
    const { addToast } = useToast();

    const [step, setStep] = useState(1);
    const [apiKey, setApiKey] = useState(() => geminiApiKey || '');
    const [enableAI, setEnableAI] = useState(() => (
        settings.enableAI && (!!geminiApiKey || isEnvKey)
    ));
    const [blurContent, setBlurContent] = useState(true);
    const [isVerifying, setIsVerifying] = useState(false);
    const [verificationStatus, setVerificationStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [verificationError, setVerificationError] = useState<string | null>(null);

    const dialogRef = useRef<HTMLDivElement>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const shouldRestoreFocusRef = useRef(true);

    const trimmedApiKey = apiKey.trim();
    const hasStoredKey = !isEnvKey && !!geminiApiKey && trimmedApiKey === geminiApiKey;
    const apiKeyInputStatus = verificationStatus === 'idle' && hasStoredKey
        ? 'configured'
        : verificationStatus;
    const hasConfiguredAiKey = hasStoredKey || verificationStatus === 'success';
    const needsAiSetup = step === 3 && enableAI && !hasConfiguredAiKey;
    const canContinue = !needsAiSetup && !isVerifying;

    useEffect(() => {
        if (!isOpen) return;

        previousFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;

        return () => {
            if (shouldRestoreFocusRef.current) previousFocusRef.current?.focus();
        };
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) headingRef.current?.focus();
    }, [isOpen, step]);

    const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Tab' || !dialogRef.current) return;

        const focusableElements = Array.from(
            dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter(element => element.tabIndex >= 0 && !element.hasAttribute('disabled'));

        if (focusableElements.length === 0) {
            event.preventDefault();
            dialogRef.current.focus();
            return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        const activeElement = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;

        if (!activeElement || !focusableElements.includes(activeElement)) {
            event.preventDefault();
            (event.shiftKey ? lastElement : firstElement).focus();
            return;
        }

        if (event.shiftKey && activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
        } else if (!event.shiftKey && activeElement === lastElement) {
            event.preventDefault();
            firstElement.focus();
        }
    };

    const handleVerifyKey = async (overrideKey?: string) => {
        const keyToVerify = (overrideKey || apiKey).trim();
        if (!keyToVerify) return;

        setIsVerifying(true);
        setVerificationStatus('idle');
        setVerificationError(null);

        try {
            const { verifyApiKey } = await import('../../services/geminiService');
            const result = await verifyApiKey(keyToVerify);

            if (!result.valid) {
                const message = result.error || 'Verification failed';
                setVerificationStatus('error');
                setVerificationError(message);
                addToast(message, 'error');
                return;
            }

            if (!overrideKey) {
                await setGeminiApiKey(keyToVerify);
            }

            setVerificationStatus('success');
            addToast(
                overrideKey ? 'Environment API key verified' : 'API key verified and saved securely',
                'success'
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            setVerificationStatus('error');
            setVerificationError(message);
            addToast(message, 'error');
        } finally {
            setIsVerifying(false);
        }
    };

    const handleNext = () => {
        if (step < TOTAL_STEPS) {
            if (!canContinue) return;
            setStep(current => Math.min(TOTAL_STEPS, current + 1));
            return;
        }

        shouldRestoreFocusRef.current = false;
        onComplete({
            enableAI,
            maskedKeywords: blurContent ? [...DEFAULT_APP_SETTINGS.maskedKeywords] : [],
            maskingMode: 'blur',
            hasCompletedOnboarding: true,
        });
    };

    const handleBack = () => {
        if (isVerifying) return;
        setStep(current => Math.max(1, current - 1));
    };

    const handleSetUpLater = () => {
        if (isVerifying) return;
        setEnableAI(false);
        setVerificationStatus('idle');
        setVerificationError(null);
        setStep(4);
    };

    if (!isOpen) {
        return preserveBackdropWhenClosed ? (
            <div
                data-testid="onboarding-backdrop"
                aria-hidden="true"
                className={ONBOARDING_BACKDROP_CLASS}
            />
        ) : null;
    }

    return (
        <div className={`${ONBOARDING_BACKDROP_CLASS} flex items-center justify-center overflow-y-auto p-2 sm:p-4`}>
            <motion.div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="onboarding-step-title"
                tabIndex={-1}
                onKeyDown={handleDialogKeyDown}
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="flex h-[calc(100dvh-1rem)] max-h-[680px] min-h-0 w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#0c0c0e] sm:h-[calc(100dvh-2rem)] md:flex-row"
            >
                <aside className="relative hidden w-1/3 flex-col justify-between overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-900 to-sage-900/40 p-8 text-white md:flex lg:p-10">
                    <div className="pointer-events-none absolute inset-0 bg-[url('/branding/noise.svg')] opacity-20 mix-blend-overlay" />
                    <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-sage-500/10 blur-[100px]" />

                    <div className="relative z-10">
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 shadow-xl backdrop-blur-xl"
                        >
                            <img src={brandGlyphSrc} alt="" className="h-10 w-10 drop-shadow-[0_6px_18px_rgba(0,0,0,0.35)]" />
                        </motion.div>
                        <h1 className="mb-2 text-3xl font-semibold uppercase leading-tight tracking-[0.18em] text-white/92">{APP_NAME}</h1>
                        <p className="text-sm leading-relaxed text-sage-100/50">Your local-first workspace for AI-generated images.</p>
                    </div>

                    <ol aria-label="Onboarding progress" className="relative z-10 space-y-4">
                        {STEP_LABELS.map((label, index) => (
                            <StepIndicator
                                key={label}
                                current={step}
                                step={index + 1}
                                label={label}
                            />
                        ))}
                    </ol>
                </aside>

                <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent p-5 sm:p-6 md:p-8 lg:p-10">
                    <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 rounded-full bg-sage-500/5 blur-[100px]" />

                    <p className="relative z-10 mb-3 text-xs font-bold uppercase tracking-widest text-sage-500 md:hidden">
                        Step {step} of {TOTAL_STEPS} · {STEP_LABELS[step - 1]}
                    </p>

                    <div
                        data-testid="onboarding-step-scroll-region"
                        className="custom-scrollbar relative z-10 min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1"
                    >
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={step}
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                transition={{ duration: 0.3, ease: 'easeOut' }}
                                onAnimationComplete={() => headingRef.current?.focus()}
                            >
                                {step === 1 ? (
                                    <div>
                                        <div className="mb-6">
                                            <h2
                                                id="onboarding-step-title"
                                                ref={headingRef}
                                                tabIndex={-1}
                                                className="mb-4 text-3xl font-bold tracking-tight text-gray-900 outline-none dark:text-white"
                                            >
                                                Organize your AI image library
                                            </h2>
                                            <p className="text-base leading-relaxed text-gray-500 dark:text-gray-400 sm:text-lg">
                                                Bring images from InvokeAI, ComfyUI, SD WebUI, and other folders into one searchable local library.
                                            </p>
                                        </div>

                                        <div className="space-y-3">
                                            <FeatureRow icon={<Search className="h-6 w-6 text-sage-400" />} title="One searchable library" desc="Find images across prompts, models, tags, dates, and generation settings." />
                                            <FeatureRow icon={<BrainCircuit className="h-6 w-6 text-sage-400" />} title="Native generation metadata" desc="Inspect prompts, seeds, parameters, and supported workflow data." />
                                            <FeatureRow icon={<Lock className="h-6 w-6 text-sage-400" />} title="Local-first by default" desc="Your catalog stays on this machine, with optional network features under your control." />
                                        </div>
                                    </div>
                                ) : null}

                                {step === 2 ? (
                                    <div>
                                        <div className="mb-5">
                                            <h2
                                                id="onboarding-step-title"
                                                ref={headingRef}
                                                tabIndex={-1}
                                                className="mb-3 text-3xl font-bold tracking-tight text-gray-900 outline-none dark:text-white"
                                            >
                                                Connect your generators
                                            </h2>
                                            <p className="max-w-md text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                                                Connect output folders to automatically import new images and preserve supported metadata.
                                            </p>
                                        </div>

                                        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                                            <IntegrationCard
                                                icon={<Image className="h-6 w-6" />}
                                                title="InvokeAI"
                                                features={['Boards & favorites', 'Live sync']}
                                                color="indigo"
                                                onSetup={() => onOpenSettings?.('invokeai')}
                                            />
                                            <IntegrationCard
                                                icon={<Workflow className="h-6 w-6" />}
                                                title="ComfyUI"
                                                features={['Output folders', 'Workflow metadata']}
                                                color="emerald"
                                                onSetup={() => onOpenSettings?.('comfyui')}
                                            />
                                            <IntegrationCard
                                                icon={<Palette className="h-6 w-6" />}
                                                title="SD WebUI"
                                                features={['A1111, Forge & more', 'Generation parameters']}
                                                color="amber"
                                                onSetup={() => onOpenSettings?.('a1111')}
                                            />
                                        </div>

                                        <div className="rounded-2xl border border-sage-500/10 bg-sage-500/5 p-4 backdrop-blur-sm dark:border-white/10 dark:bg-white/5">
                                            <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                                                Ambit watches connected folders for new images. InvokeAI can also sync supported favorites and boards.
                                            </p>
                                            <button
                                                type="button"
                                                onClick={() => onOpenSettings?.('folders')}
                                                className="mt-3 inline-flex items-center gap-2 rounded-lg text-xs font-bold text-sage-600 hover:text-sage-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 dark:text-sage-400"
                                            >
                                                <FolderOpen className="h-4 w-4" aria-hidden="true" />
                                                Add another image folder
                                            </button>
                                        </div>
                                    </div>
                                ) : null}

                                {step === 3 ? (
                                    <div>
                                        <div className="mb-5">
                                            <h2
                                                id="onboarding-step-title"
                                                ref={headingRef}
                                                tabIndex={-1}
                                                className="mb-3 text-3xl font-bold tracking-tight text-gray-900 outline-none dark:text-white"
                                            >
                                                Optional Gemini features
                                            </h2>
                                            <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                                                Use Gemini on demand for natural-language filtering and prompt tools.
                                            </p>
                                        </div>

                                        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                            <CompactFeature icon={<History className="h-4 w-4" />} title="AI Prompt Recovery" description="Infer a replacement prompt from an image" />
                                            <CompactFeature icon={<BrainCircuit className="h-4 w-4" />} title="Prompt Analysis" description="Review a prompt and suggest improvements" />
                                            <CompactFeature icon={<Wand2 className="h-4 w-4" />} title="Prompt Variations" description="Generate alternate prompt ideas" />
                                            <CompactFeature icon={<Search className="h-4 w-4" />} title="Natural-language search" description="Turn requests into library filters" />
                                        </div>

                                        <button
                                            type="button"
                                            role="switch"
                                            aria-label="Enable AI features"
                                            aria-checked={enableAI}
                                            disabled={isVerifying}
                                            onClick={() => setEnableAI(current => !current)}
                                            className={`mb-5 flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 disabled:cursor-not-allowed disabled:opacity-50 ${enableAI ? 'border-sage-500/50 bg-sage-500/5' : 'border-gray-200 dark:border-white/10'}`}
                                        >
                                            <span aria-hidden="true" className={`flex h-6 w-6 items-center justify-center rounded-lg border transition-all ${enableAI ? 'border-sage-500 bg-sage-500 shadow-lg shadow-sage-500/20' : 'border-gray-400'}`}>
                                                {enableAI ? <Check className="h-4 w-4 text-white" /> : null}
                                            </span>
                                            <span className="flex-1">
                                                <span className="block font-bold text-gray-900 dark:text-white">Enable AI features</span>
                                                <span className="text-xs text-gray-500">Gemini is contacted only when you verify the key or run an AI action.</span>
                                            </span>
                                        </button>

                                        {enableAI ? (
                                            <motion.div
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                className="space-y-3"
                                            >
                                                <ApiKeyInput
                                                    value={apiKey}
                                                    onChange={(value) => {
                                                        setApiKey(value);
                                                        setVerificationStatus('idle');
                                                        setVerificationError(null);
                                                    }}
                                                    onVerify={() => handleVerifyKey()}
                                                    isVerifying={isVerifying}
                                                    status={apiKeyInputStatus}
                                                    error={verificationError}
                                                    isEnvKey={isEnvKey}
                                                    onTestEnvKey={() => {
                                                        const keyToTest = process.env.API_KEY || '';
                                                        if (keyToTest) void handleVerifyKey(keyToTest);
                                                    }}
                                                />
                                                <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                                                    {isEnvKey
                                                        ? 'Ambit reads this API key from your environment and does not save it. Gemini requests are handled by Google under your AI Studio plan. A free tier is available for eligible accounts and regions; limits apply.'
                                                        : 'Stored in your OS keyring. Gemini requests are handled by Google under your AI Studio plan. A free tier is available for eligible accounts and regions; limits apply.'}
                                                </p>
                                                {needsAiSetup ? (
                                                    <p role="status" className="text-xs font-medium text-amber-600 dark:text-amber-400">
                                                        Verify your key to continue, or set up Gemini later.
                                                    </p>
                                                ) : null}
                                            </motion.div>
                                        ) : null}
                                    </div>
                                ) : null}

                                {step === 4 ? (
                                    <div>
                                        <div className="mb-5">
                                            <h2
                                                id="onboarding-step-title"
                                                ref={headingRef}
                                                tabIndex={-1}
                                                className="mb-4 text-3xl font-bold tracking-tight text-gray-900 outline-none dark:text-white"
                                            >
                                                Privacy & control
                                            </h2>
                                            <div className="space-y-3">
                                                <PrivacyRow icon={<ServerOff className="h-6 w-6" />} title="Stored locally" description="Your image catalog, metadata, and settings stay on this machine. Ambit does not send telemetry." />
                                                <PrivacyRow icon={<FileJson className="h-6 w-6" />} title="Gemini requests" description="Images or prompts are sent to Google only when you verify the key or run an AI action." />
                                                <PrivacyRow icon={<Link2 className="h-6 w-6" />} title="Optional network access" description="Ambit can check GitHub Releases at startup when updates are enabled. CivitAI lookups run only after you confirm Resolve Online." />
                                            </div>
                                        </div>

                                        <div className="rounded-2xl border border-sage-500/10 bg-gradient-to-br from-sage-500/10 to-transparent p-5 dark:border-white/10 dark:from-white/5 dark:to-transparent">
                                            <div className="flex items-center gap-4">
                                                <div className="shrink-0 rounded-xl border border-gray-100 bg-white p-3 shadow-lg dark:border-white/5 dark:bg-zinc-800">
                                                    <EyeOff className="h-7 w-7 text-sage-500" />
                                                </div>
                                                <div className="flex-1">
                                                    <h3 className="font-bold text-gray-900 dark:text-white">Prompt keyword masking</h3>
                                                    <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                                                        Blur images whose prompts match your configured sensitive-content keywords. Edit the list in Settings → Privacy.
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    role="switch"
                                                    aria-label="Enable prompt keyword masking"
                                                    aria-checked={blurContent}
                                                    onClick={() => setBlurContent(current => !current)}
                                                    className={`relative h-7 w-14 shrink-0 rounded-full shadow-inner transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 ${blurContent ? 'bg-sage-500' : 'bg-gray-300 dark:bg-zinc-700'}`}
                                                >
                                                    <span
                                                        aria-hidden="true"
                                                        className={`pointer-events-none absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-lg transition-transform duration-300 ${blurContent ? 'translate-x-7' : 'translate-x-0'}`}
                                                    />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ) : null}
                            </motion.div>
                        </AnimatePresence>
                    </div>

                    <footer className="relative z-10 mt-4 flex shrink-0 items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-white/5">
                        <div aria-hidden="true" className="hidden gap-1.5 sm:flex">
                            {[1, 2, 3, 4].map(item => (
                                <span key={item} className={`h-1.5 rounded-full transition-all duration-500 ${item === step ? 'w-10 bg-sage-500' : 'w-2 bg-gray-200 dark:bg-white/10'}`} />
                            ))}
                        </div>

                        <div className="ml-auto flex flex-wrap justify-end gap-2 sm:gap-3">
                            {step > 1 ? (
                                <button
                                    type="button"
                                    onClick={handleBack}
                                    disabled={isVerifying}
                                    className="rounded-xl px-4 py-2.5 text-sm font-bold text-gray-400 transition-all hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/5 dark:hover:text-white"
                                >
                                    Back
                                </button>
                            ) : null}
                            {needsAiSetup ? (
                                <button
                                    type="button"
                                    onClick={handleSetUpLater}
                                    disabled={isVerifying}
                                    className="rounded-xl px-4 py-2.5 text-sm font-bold text-sage-600 transition-all hover:bg-sage-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-sage-400"
                                >
                                    Set up later
                                </button>
                            ) : null}
                            <button
                                type="button"
                                onClick={handleNext}
                                disabled={!canContinue}
                                className="flex items-center gap-3 whitespace-nowrap rounded-2xl bg-gray-900 px-5 py-2.5 text-sm font-black text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:shadow-white/5"
                            >
                                {step === TOTAL_STEPS ? 'Finish setup' : 'Continue'}
                                <ArrowRight className="h-5 w-5 stroke-[2.5]" aria-hidden="true" />
                            </button>
                        </div>
                    </footer>
                </div>
            </motion.div>
        </div>
    );
};

const StepIndicator = ({ current, step, label }: { current: number; step: number; label: string }) => {
    const active = current === step;
    const completed = current > step;

    return (
        <li
            aria-current={active ? 'step' : undefined}
            className={`flex items-center gap-4 transition-all duration-500 ${active ? 'translate-x-1 opacity-100' : 'opacity-40'}`}
        >
            <span aria-hidden="true" className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-black shadow-sm transition-all duration-500 ${active ? 'scale-110 border-white bg-white text-zinc-900 shadow-lg shadow-white/20' : completed ? 'border-sage-500 bg-sage-500 text-white' : 'border-white/20 text-white'}`}>
                {completed ? <Check className="h-4 w-4 stroke-[3]" /> : step}
            </span>
            <span className={`text-sm tracking-wide transition-all ${active ? 'font-black' : 'font-medium'}`}>{label}</span>
        </li>
    );
};

const FeatureRow = ({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) => (
    <div className="flex items-center gap-4 rounded-2xl border border-transparent p-3 transition-all duration-300 hover:border-sage-500/10 hover:bg-sage-500/5 dark:hover:border-white/10 dark:hover:bg-white/5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-100 bg-white shadow-md dark:border-white/10 dark:bg-white/5">
            {icon}
        </div>
        <div>
            <div className="text-sm font-black tracking-tight text-gray-900 dark:text-white">{title}</div>
            <div className="text-xs font-medium leading-relaxed text-gray-500 dark:text-sage-100/50">{desc}</div>
        </div>
    </div>
);

const CompactFeature = ({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) => (
    <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-white/5 dark:bg-white/5">
        <div className="rounded-lg border border-gray-100 bg-white p-2 text-sage-500 shadow-sm dark:border-white/5 dark:bg-white/5">
            {icon}
        </div>
        <div>
            <div className="text-xs font-bold text-gray-900 dark:text-white">{title}</div>
            <div className="mt-0.5 text-[11px] leading-tight text-gray-500">{description}</div>
        </div>
    </div>
);

const PrivacyRow = ({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) => (
    <div className="flex items-start gap-4 rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-white/5 dark:bg-white/5">
        <span aria-hidden="true" className="mt-1 text-sage-500">{icon}</span>
        <div className="flex-1">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{description}</p>
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
            hover: 'hover:bg-indigo-500/5 hover:border-indigo-500/30 hover:shadow-[0_0_20px_rgba(99,102,241,0.15)]',
            icon: 'bg-indigo-500/10 text-indigo-500',
            dot: 'bg-indigo-400',
            text: 'text-indigo-500',
        },
        emerald: {
            hover: 'hover:bg-emerald-500/5 hover:border-emerald-500/30 hover:shadow-[0_0_20px_rgba(16,185,129,0.15)]',
            icon: 'bg-emerald-500/10 text-emerald-500',
            dot: 'bg-emerald-400',
            text: 'text-emerald-500',
        },
        amber: {
            hover: 'hover:bg-amber-500/5 hover:border-amber-500/30 hover:shadow-[0_0_20px_rgba(245,158,11,0.15)]',
            icon: 'bg-amber-500/10 text-amber-500',
            dot: 'bg-amber-400',
            text: 'text-amber-500',
        },
    }[color];

    return (
        <motion.button
            type="button"
            whileHover={{ y: -4 }}
            onClick={onSetup}
            className={`group rounded-2xl border border-gray-100 bg-white p-4 text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 dark:border-white/10 dark:bg-white/[0.02] ${colors.hover}`}
        >
            <span className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl shadow-sm transition-transform duration-500 group-hover:scale-110 ${colors.icon}`}>
                {icon}
            </span>
            <span className="mb-3 block text-sm font-black tracking-tight text-gray-900 dark:text-white">{title}</span>
            <span className="mb-4 block space-y-2">
                {features.map(feature => (
                    <span key={feature} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                        <span aria-hidden="true" className={`h-1 w-1 rounded-full ${colors.dot}`} />
                        {feature}
                    </span>
                ))}
            </span>
            <span className={`text-xs font-black uppercase tracking-wider ${colors.text}`}>Set up →</span>
        </motion.button>
    );
};
