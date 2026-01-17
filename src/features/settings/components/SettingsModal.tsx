import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Monitor, Shield, FlaskConical, Terminal, Link } from 'lucide-react';
import { AppSettings } from '../../../types';
import { GeneralTab, PrivacyTab, ExperimentsTab, DevTab, AdvancedTab, ConnectionsTab } from './';
import { APP_NAME, APP_VERSION } from '../../../constants/app';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  initialTab?: 'general' | 'folders' | 'privacy' | 'experiments' | 'invokeai' | 'a1111' | 'comfyui' | 'dev';
  onScanFolder?: (folders: { path: string, variant?: string }[]) => Promise<void>;
}

type SettingsTab = 'general' | 'connections' | 'privacy' | 'experiments' | 'dev' | 'advanced';

const TAB_LABELS: Record<SettingsTab, string> = {
  general: 'General',
  connections: 'Connections',
  privacy: 'Privacy',
  experiments: 'Experiments',
  dev: 'Dev Tools',
  advanced: 'Advanced'
};

interface TabButtonProps {
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: (id: SettingsTab) => void;
}

const TabButton: React.FC<TabButtonProps> = ({ id, label, icon, isActive, onClick }) => (
  <button
    type="button"
    onClick={() => onClick(id)}
    className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 cursor-pointer mb-1 ${isActive
      ? 'bg-white/10 text-white shadow-inner border border-white/10'
      : 'text-gray-400 hover:bg-white/5 hover:text-white'
      }`}
  >
    <div className={`${isActive ? 'text-sage-300' : 'text-gray-500 group-hover:text-gray-300'}`}>
      {icon}
    </div>
    {label}
  </button>
);

export const SettingsModal: React.FC<SettingsModalProps> = React.memo(({
  isOpen,
  onClose,
  settings,
  onSave,
  initialTab = 'general',
  onScanFolder
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [connectionSubTab, setConnectionSubTab] = useState<'folders' | 'invokeai' | 'a1111' | 'comfyui' | undefined>(undefined);

  // Reset to initial tab when modal opens
  useEffect(() => {
    if (isOpen) {
      if (['folders', 'invokeai', 'a1111', 'comfyui'].includes(initialTab)) {
        setActiveTab('connections');
        setConnectionSubTab(initialTab as any);
      } else {
        setActiveTab(initialTab as SettingsTab);
        setConnectionSubTab(undefined);
      }
    }
  }, [isOpen, initialTab]);

  // Auto-save wrapper: calls onSave directly on any change
  const handleSettingsChange: React.Dispatch<React.SetStateAction<AppSettings>> = useCallback(
    (updater) => {
      if (typeof updater === 'function') {
        onSave(updater(settings));
      } else {
        onSave(updater);
      }
    },
    [onSave, settings]
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{
              opacity: { duration: 0.15, delay: 0.05 },
              scale: { type: "spring", stiffness: 400, damping: 30, delay: 0.05 }
            }}
            className="w-full max-w-5xl bg-card border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl flex h-[680px] max-h-[85vh] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >

            {/* Sidebar */}
            <div className="w-64 bg-gradient-to-b from-gray-900 to-sage-950 flex flex-col p-4 shrink-0 relative overflow-hidden">
              {/* Noise Texture Overlay - inline SVG to prevent network-related flash */}
              <div
                className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-overlay"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
                }}
              />

              <div className="relative z-10">
                <h2 className="text-lg font-bold text-white mb-8 px-4 mt-2 tracking-tight">{APP_NAME} Preferences</h2>
                <nav className="space-y-6">
                  <div>
                    <h4 className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] px-4 mb-2">Application</h4>
                    <TabButton id="general" label="General" icon={<Monitor className="w-4 h-4" />} isActive={activeTab === 'general'} onClick={setActiveTab} />
                    <TabButton id="connections" label="Connections" icon={<Link className="w-4 h-4" />} isActive={activeTab === 'connections'} onClick={setActiveTab} />
                  </div>

                  <div>
                    <h4 className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] px-4 mb-2">Security</h4>
                    <TabButton id="privacy" label="Privacy" icon={<Shield className="w-4 h-4" />} isActive={activeTab === 'privacy'} onClick={setActiveTab} />
                  </div>

                  <div>
                    <h4 className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] px-4 mb-2">Advanced</h4>
                    <TabButton id="advanced" label="Advanced" icon={<Shield className="w-4 h-4" />} isActive={activeTab === 'advanced'} onClick={setActiveTab} />
                    <TabButton id="experiments" label="Experiments" icon={<FlaskConical className="w-4 h-4" />} isActive={activeTab === 'experiments'} onClick={setActiveTab} />
                    <TabButton id="dev" label="Dev Tools" icon={<Terminal className="w-4 h-4" />} isActive={activeTab === 'dev'} onClick={setActiveTab} />
                  </div>
                </nav>
              </div>

              <div className="mt-auto relative z-10 text-xs text-gray-500 px-4">
                v{APP_VERSION}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col min-w-0 bg-background">
              <div className="flex items-center justify-between p-8 pb-4 shrink-0">
                <div className="flex flex-col">
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
                    {TAB_LABELS[activeTab]}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage your application preferences and connections.</p>
                </div>
                <button type="button" onClick={onClose} className="p-2 bg-gray-200 dark:bg-white/5 rounded-full text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className={activeTab === 'dev' ? "flex-1 flex flex-col min-h-0 overflow-hidden" : "flex-1 overflow-y-auto custom-scrollbar p-8 pt-4"}>
                {activeTab === 'general' && <GeneralTab settings={settings} setSettings={handleSettingsChange} />}
                {activeTab === 'connections' && (
                  <ConnectionsTab
                    settings={settings}
                    setSettings={handleSettingsChange}
                    onScanFolder={onScanFolder}
                    initialSubTab={connectionSubTab}
                    onClose={onClose}
                  />
                )}
                {activeTab === 'privacy' && <PrivacyTab settings={settings} setSettings={handleSettingsChange} />}
                {activeTab === 'experiments' && <ExperimentsTab settings={settings} setSettings={handleSettingsChange} />}
                {activeTab === 'advanced' && <AdvancedTab settings={settings} setSettings={handleSettingsChange} />}
                {activeTab === 'dev' && <DevTab />}
              </div>

            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
