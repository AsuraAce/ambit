import * as React from 'react';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Monitor, Folder, Save, Shield, FlaskConical, DatabaseZap, Palette } from 'lucide-react';
import { AppSettings } from '../types';
import { GeneralTab, FoldersTab, PrivacyTab, ExperimentsTab, InvokeAITab, A1111Tab } from './settings/SettingsTabs';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  initialTab?: 'general' | 'folders' | 'privacy' | 'experiments' | 'invokeai' | 'a1111';
}

type SettingsTab = 'general' | 'folders' | 'privacy' | 'experiments' | 'invokeai' | 'a1111';

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
  initialTab = 'general'
}) => {
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settings);
      setActiveTab(initialTab);
    }
  }, [isOpen, settings, initialTab]);



  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

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
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            className="w-full max-w-5xl bg-white dark:bg-[#09090b] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl flex h-auto max-h-[85vh] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >

            {/* Sidebar */}
            <div className="w-64 bg-gradient-to-b from-gray-900 to-sage-950 flex flex-col p-4 shrink-0 relative overflow-hidden">
              {/* Noise Texture Overlay */}
              <div className="absolute top-0 left-0 w-full h-full bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 pointer-events-none"></div>

              <div className="relative z-10">
                <h2 className="text-lg font-bold text-white mb-8 px-4 mt-2 tracking-tight">Ambit Preferences</h2>
                <nav className="space-y-6">
                  <div>
                    <h4 className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] px-4 mb-2">Application</h4>
                    <TabButton id="general" label="General" icon={<Monitor className="w-4 h-4" />} isActive={activeTab === 'general'} onClick={setActiveTab} />
                    <TabButton id="folders" label="Folders" icon={<Folder className="w-4 h-4" />} isActive={activeTab === 'folders'} onClick={setActiveTab} />
                  </div>

                  <div>
                    <h4 className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] px-4 mb-2">Generators</h4>
                    <TabButton id="invokeai" label="InvokeAI" icon={<DatabaseZap className="w-4 h-4" />} isActive={activeTab === 'invokeai'} onClick={setActiveTab} />
                    <TabButton id="a1111" label="SD WebUI" icon={<Palette className="w-4 h-4" />} isActive={activeTab === 'a1111'} onClick={setActiveTab} />
                  </div>

                  <div>
                    <h4 className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] px-4 mb-2">Security</h4>
                    <TabButton id="privacy" label="Privacy" icon={<Shield className="w-4 h-4" />} isActive={activeTab === 'privacy'} onClick={setActiveTab} />
                  </div>

                  <div>
                    <h4 className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] px-4 mb-2">Advanced</h4>
                    <TabButton id="experiments" label="Experiments" icon={<FlaskConical className="w-4 h-4" />} isActive={activeTab === 'experiments'} onClick={setActiveTab} />
                  </div>
                </nav>
              </div>

              <div className="mt-auto relative z-10 text-xs text-gray-500 px-4">
                v0.9.3 Beta
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col min-w-0 bg-gray-50/50 dark:bg-[#09090b]">
              <div className="flex items-center justify-between p-8 pb-4 shrink-0">
                <div className="flex flex-col">
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white capitalize">{activeTab}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage your application preferences and connections.</p>
                </div>
                <button type="button" onClick={onClose} className="p-2 bg-gray-200 dark:bg-white/5 rounded-full text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar p-8 pt-4">
                {activeTab === 'general' && <GeneralTab settings={localSettings} setSettings={setLocalSettings} />}
                {activeTab === 'folders' && <FoldersTab settings={localSettings} setSettings={setLocalSettings} />}
                {activeTab === 'invokeai' && <InvokeAITab settings={localSettings} setSettings={setLocalSettings} />}
                {activeTab === 'a1111' && <A1111Tab settings={localSettings} setSettings={setLocalSettings} />}
                {activeTab === 'privacy' && <PrivacyTab settings={localSettings} setSettings={setLocalSettings} />}
                {activeTab === 'experiments' && <ExperimentsTab settings={localSettings} setSettings={setLocalSettings} />}
              </div>

              <div className="p-6 border-t border-gray-200 dark:border-white/5 flex justify-end gap-3 bg-white dark:bg-[#09090b] shrink-0">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="px-6 py-2.5 bg-sage-600 hover:bg-sage-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-sage-500/20 flex items-center gap-2 transition-all transform active:scale-95"
                >
                  <Save className="w-4 h-4" /> Save Changes
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});