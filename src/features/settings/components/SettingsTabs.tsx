import * as React from 'react';
import { useState, useMemo } from 'react';
import {
  Monitor,
  Folder,
  Eye,
  FlaskConical,
  Shield,
  Palette,
  DatabaseZap,
  ChevronRight
} from 'lucide-react';
import { AppSettings } from '../../../types';
import { APP_NAME, APP_VERSION } from '../../../constants/app';

import { GeneralTab } from './GeneralTab';
import { FoldersTab } from './FoldersTab';
import { PrivacyTab } from './PrivacyTab';
import { ExperimentsTab } from './ExperimentsTab';
import { InvokeAITab } from './InvokeAITab';
import { A1111Tab } from './A1111Tab';
import { AdvancedTab } from './AdvancedTab';

interface SettingsTabsProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const SettingsTabs: React.FC<SettingsTabsProps> = ({ settings, setSettings }) => {
  const [activeTab, setActiveTab] = useState<'general' | 'folders' | 'privacy' | 'invoke' | 'a1111' | 'advanced' | 'ai'>('general');

  const tabs = useMemo(() => [
    { id: 'general', label: 'General', icon: Monitor, description: 'Theme and basic behavior' },
    { id: 'folders', label: 'Watchfolders', icon: Folder, description: 'Image library sources' },
    { id: 'a1111', label: 'Stable Diffusion', icon: Palette, description: 'A1111 & Forge integration' },
    { id: 'invoke', label: 'InvokeAI', icon: DatabaseZap, description: 'InvokeAI database sync' },
    { id: 'ai', label: 'AI Features', icon: FlaskConical, description: 'Gemini & Local AI' },
    { id: 'privacy', label: 'Privacy', icon: Eye, description: 'Keyword masking' },
    { id: 'advanced', label: 'Advanced', icon: Shield, description: 'System & Maintenance' },
  ], []);

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'general': return <GeneralTab settings={settings} setSettings={setSettings} />;
      case 'folders': return <FoldersTab settings={settings} setSettings={setSettings} />;
      case 'privacy': return <PrivacyTab settings={settings} setSettings={setSettings} />;
      case 'ai': return <ExperimentsTab settings={settings} setSettings={setSettings} />;
      case 'invoke': return <InvokeAITab settings={settings} setSettings={setSettings} />;
      case 'a1111': return <A1111Tab settings={settings} setSettings={setSettings} />;
      case 'advanced': return <AdvancedTab settings={settings} setSettings={setSettings} />;
      default: return <GeneralTab settings={settings} setSettings={setSettings} />;
    }
  };

  return (
    <div className="flex h-full bg-white dark:bg-black/20 rounded-2xl border border-gray-200 dark:border-white/5 overflow-hidden shadow-2xl">
      {/* Sidebar Navigation */}
      <div className="w-64 border-r border-gray-200 dark:border-white/5 bg-gray-50/50 dark:bg-black/20 flex flex-col">
        <div className="p-6">
          <h2 className="text-sm font-black text-gray-400 uppercase tracking-[0.2em] mb-1">Settings</h2>
          <p className="text-[10px] text-gray-500 font-medium italic">Configure your workspace</p>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group relative ${isActive
                  ? 'bg-sage-600 text-white shadow-lg shadow-sage-600/20 z-10'
                  : 'text-gray-500 hover:bg-gray-200/50 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white'
                  }`}
              >
                <Icon className={`w-5 h-5 transition-transform duration-500 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`} />
                <div className="text-left">
                  <div className="text-sm font-bold tracking-tight">{tab.label}</div>
                  {!isActive && <div className="text-[10px] opacity-60 font-medium truncate w-32">{tab.description}</div>}
                </div>
                {isActive && (
                  <div className="absolute right-3">
                    <ChevronRight className="w-4 h-4 opacity-50" />
                  </div>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-200 dark:border-white/5">
          <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest text-center px-2">
            {APP_NAME} Alpha v{APP_VERSION}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto bg-white/50 dark:bg-transparent custom-scrollbar">
        <div className="p-8 lg:p-12">
          {renderActiveTab()}
        </div>
      </div>
    </div>
  );
};
