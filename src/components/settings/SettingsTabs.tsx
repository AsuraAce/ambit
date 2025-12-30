import * as React from 'react';
import { useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Monitor, Folder, Plus, Trash2, FolderSearch, AlertTriangle, Shield, Eye, Lock, FlaskConical, Clock, Zap, Palette, Save, Loader2, XCircle, Moon, Sun, Key, Activity, Database, Search, Files, LayoutGrid, CheckCircle2, Layers, Settings2, Globe, DatabaseZap, RefreshCw, BarChart3, Info, FolderOpen, History, Boxes, ZapOff } from 'lucide-react';
import { useLibrary } from '../../contexts/LibraryContext';
import { AppSettings, MonitoredFolder } from '../../types';

import { ConfirmDialog } from '../ConfirmDialog';

interface TabProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

// --- Granular Memoized Tabs ---

const LibraryHealthLazy = React.lazy(() => import('../maintenance/LibraryHealth').then(m => ({ default: m.LibraryHealth })));

// --- GENERAL TAB ---
export const GeneralTab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => (
  <div className="space-y-8 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
    <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-6">Appearance</h4>
      <label className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-4">
          <div className={`p-3 rounded-xl transition-colors ${settings.theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700'}`}>
            {settings.theme === 'dark' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
          </div>
          <div>
            <div className="text-base font-medium text-gray-900 dark:text-gray-200 group-hover:text-sage-500 transition-colors">Theme Mode</div>
            <div className="text-sm text-gray-500">{settings.theme === 'dark' ? 'Dark Mode Active' : 'Light Mode Active'}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSettings(prev => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }))}
          className="text-xs font-bold px-4 py-2 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/20 transition-colors"
        >
          Switch
        </button>
      </label>
    </section>

    <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-6">File Operations</h4>
      <label className="flex items-center justify-between cursor-pointer group">
        <div>
          <div className="text-base font-medium text-gray-900 dark:text-gray-200 group-hover:text-sage-500 transition-colors">Confirm Deletions</div>
          <div className="text-sm text-gray-500">Show a warning before moving files to Trash</div>
        </div>
        <div className={`w-12 h-7 rounded-full relative transition-colors ${settings.confirmDelete ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}>
          <input
            type="checkbox"
            className="hidden"
            checked={settings.confirmDelete}
            onChange={() => setSettings(prev => ({ ...prev, confirmDelete: !prev.confirmDelete }))}
          />
          <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${settings.confirmDelete ? 'left-6' : 'left-1'}`} />
        </div>
      </label>

      <div className="pt-6 border-t border-gray-100 dark:border-white/5">
        <React.Suspense fallback={<div className="h-20 bg-gray-100 dark:bg-white/5 rounded-xl animate-pulse" />}>
          <LibraryHealthLazy mode="compact" onNavigateToMaintenance={() => window.location.hash = '#maintenance'} />
        </React.Suspense>
      </div>
    </section>
  </div>
));

// --- FOLDERS TAB ---
export const FoldersTab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
  const [newFolderPath, setNewFolderPath] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderPath.trim()) return;

    const newFolder: MonitoredFolder = {
      id: `folder_${Date.now()}`,
      path: newFolderPath,
      isActive: true,
      imageCount: 0
    };

    setSettings(prev => ({
      ...prev,
      monitoredFolders: [...prev.monitoredFolders, newFolder]
    }));
    setNewFolderPath('');
  };

  const removeFolder = (id: string) => {
    setSettings(prev => ({
      ...prev,
      monitoredFolders: prev.monitoredFolders.filter(f => f.id !== id)
    }));
  };

  const handleBrowse = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Folder to Monitor'
      });

      if (selected && typeof selected === 'string') {
        const { normalizePath } = await import('../../utils/pathUtils');
        setNewFolderPath(normalizePath(selected));
      }
    } catch (e) {
      console.warn('Native dialog failed, falling back to input', e);
      fileInputRef.current?.click();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const relativePath = files[0].webkitRelativePath;
      const folderName = relativePath.split('/')[0] || 'Selected_Folder';
      setNewFolderPath(`D:/AI_Workflows/${folderName} (Simulated)`);
    }
    if (e.target) e.target.value = '';
  };

  return (
    <div className="space-y-6 max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="p-4 bg-sage-50 dark:bg-sage-500/10 border border-sage-200 dark:border-sage-500/20 rounded-xl text-sm text-sage-800 dark:text-sage-200 flex items-start gap-3">
        <Monitor className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div>
          <strong className="block mb-1">Local Monitoring</strong>
          Ambit watches these folders for new images and automatically adds them to your library.
        </div>
      </div>

      <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl overflow-hidden shadow-sm">
        <div className="p-2 space-y-1">
          {settings.monitoredFolders.map(folder => (
            <div key={folder.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 group transition-colors">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="p-2 bg-gray-100 dark:bg-white/10 rounded-lg text-gray-500 dark:text-gray-400">
                  <Folder className="w-4 h-4" />
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-300 font-mono truncate">{folder.path}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">{folder.imageCount} images</span>
                <button
                  type="button"
                  onClick={() => removeFolder(folder.id)}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          {settings.monitoredFolders.length === 0 && (
            <div className="text-sm text-gray-400 text-center py-8 italic">No folders currently monitored.</div>
          )}
        </div>
        <div className="border-t border-gray-200 dark:border-white/5 p-4 bg-gray-50/50 dark:bg-black/20">
          <form onSubmit={handleAddFolder} className="flex gap-2">
            <input
              type="text"
              value={newFolderPath}
              onChange={(e) => setNewFolderPath(e.target.value)}
              placeholder="e.g. D:/StableDiffusion/outputs"
              className="flex-1 bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-sage-500 outline-none text-gray-900 dark:text-white placeholder-gray-400"
            />
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
              {...({ webkitdirectory: "", directory: "" } as any)}
            />
            <button
              type="button"
              onClick={handleBrowse}
              className="px-3 py-2 bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-white/20 transition-colors"
              title="Browse"
            >
              <FolderSearch className="w-4 h-4" />
            </button>
            <button
              type="submit"
              disabled={!newFolderPath.trim()}
              className="px-4 py-2 bg-sage-600 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg hover:bg-sage-500 transition-colors font-medium text-sm flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </form>
        </div>
      </div>
    </div>
  );
});

// --- PRIVACY TAB ---
export const PrivacyTab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
  const [keywordInput, setKeywordInput] = useState(settings.maskedKeywords.join(', '));

  const handleKeywordsChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setKeywordInput(e.target.value);
    const split = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
    setSettings(prev => ({ ...prev, maskedKeywords: split }));
  };

  return (
    <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
      <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-6">Safety Filters</h4>

        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-sage-50 dark:bg-white/10 rounded-lg text-sage-600 dark:text-sage-400">
              <Shield className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <label className="text-sm font-bold text-gray-900 dark:text-white block mb-1">Masking Behavior</label>
              <div className="flex gap-4 mt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="maskingMode"
                    checked={settings.maskingMode === 'blur'}
                    onChange={() => setSettings(prev => ({ ...prev, maskingMode: 'blur' }))}
                    className="accent-sage-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Blur Content</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="maskingMode"
                    checked={settings.maskingMode === 'hide'}
                    onChange={() => setSettings(prev => ({ ...prev, maskingMode: 'hide' }))}
                    className="accent-sage-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Hide Completely</span>
                </label>
              </div>
            </div>
          </div>

          <div>
            <label className="text-sm font-bold text-gray-900 dark:text-white block mb-2">Masked Keywords</label>
            <textarea
              value={keywordInput}
              onChange={handleKeywordsChange}
              placeholder="nsfw, blood, gore..."
              className="w-full bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl p-3 text-sm focus:border-sage-500 outline-none min-h-[100px] text-gray-700 dark:text-gray-300"
            />
            <p className="text-xs text-gray-500 mt-2">Images with prompts containing these words will be masked or hidden.</p>
          </div>
        </div>
      </section>
    </div>
  );
});

// --- EXPERIMENTS TAB ---
export const ExperimentsTab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
  return (
    <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
      <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-6 flex items-center gap-2">
          <FlaskConical className="w-4 h-4" /> AI Integration
        </h4>

        <div className="space-y-6">
          <label className="flex items-center justify-between cursor-pointer group">
            <div>
              <div className="text-base font-medium text-gray-900 dark:text-gray-200 group-hover:text-sage-500 transition-colors">Enable AI Features</div>
              <div className="text-sm text-gray-500">Unlocks natural language search, prompt analysis, and metadata recovery.</div>
            </div>
            <div className={`w-12 h-7 rounded-full relative transition-colors ${settings.enableAI ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}>
              <input
                type="checkbox"
                className="hidden"
                checked={settings.enableAI}
                onChange={() => setSettings(prev => ({ ...prev, enableAI: !prev.enableAI }))}
              />
              <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${settings.enableAI ? 'left-6' : 'left-1'}`} />
            </div>
          </label>

          {settings.enableAI && (
            <div className="animate-in fade-in slide-in-from-top-2">
              <label className="text-sm font-bold text-gray-900 dark:text-white block mb-2 flex items-center gap-2">
                <Key className="w-4 h-4 text-gray-400" /> Google Gemini API Key
              </label>
              <input
                type="password"
                value={settings.googleGeminiApiKey || ''}
                onChange={(e) => setSettings(prev => ({ ...prev, googleGeminiApiKey: e.target.value }))}
                placeholder="AIzaSy..."
                className="w-full bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl p-3 text-sm focus:border-sage-500 outline-none text-gray-700 dark:text-gray-300 font-mono"
              />
              <p className="text-xs text-gray-500 mt-2">
                Your key is stored locally. Get one at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-sage-600 hover:underline">Google AI Studio</a>.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
});

// --- INVOKEAI TAB ---

export const InvokeAITab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [diagData, setDiagData] = useState<any>(null);
  const [isDiagLoading, setIsDiagLoading] = useState(false);

  const runDiagnostics = async () => {
    if (!settings.invokeAiPath) return;
    setIsDiagLoading(true);
    try {
      const { diagnoseInvokeAI } = await import('../../services/invoke/connection');
      const dbDiag = await diagnoseInvokeAI(settings.invokeAiPath);
      const folderAudit: any = await invoke('audit_invokeai_folder', { path: settings.invokeAiPath });

      setDiagData({
        ...dbDiag,
        folder: folderAudit
      });
    } catch (e) {
      console.error(e);
    } finally {
      setIsDiagLoading(false);
    }
  };

  const handleTestConnection = async () => {
    if (!settings.invokeAiPath) return;
    setIsTesting(true);
    setTestResult(null);

    try {
      const { testConnection } = await import('../../services/invoke/connection');
      const result = await testConnection(settings.invokeAiPath);
      setTestResult({ success: result.success, message: result.message });
    } catch (e) {
      console.error(e);
      setTestResult({ success: false, message: "Failed to load integration service." });
    } finally {
      setIsTesting(false);
    }
  };

  const handleBrowse = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select InvokeAI Root Folder'
      });

      if (selected && typeof selected === 'string') {
        setSettings(prev => ({ ...prev, invokeAiPath: selected }));
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="px-1">
        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
          InvokeAI Integration
        </h3>
        <p className="text-sm text-gray-500">
          Connect and manage your InvokeAI installation.
        </p>
      </div>

      <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm relative overflow-hidden group">
        <h4 className="text-[10px] font-black text-sage-600 dark:text-sage-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
          <DatabaseZap className="w-4 h-4" /> InvokeAI Integration
        </h4>

        <div className="space-y-6">
          <div className="relative">
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">
              Root Installation Path
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative group">
                <input
                  type="text"
                  value={settings.invokeAiPath || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, invokeAiPath: e.target.value }))}
                  placeholder="e.g. C:\AI\invokeai"
                  className="w-full bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:border-sage-500 focus:ring-1 focus:ring-sage-500/50 outline-none text-gray-900 dark:text-white font-mono transition-all"
                />
                <Folder className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-sage-500 transition-colors" />
              </div>
              <button
                type="button"
                onClick={handleBrowse}
                className="px-4 py-2.5 bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-white/20 active:scale-95 transition-all text-sm font-bold"
              >
                Browse
              </button>
            </div>
            <p className="text-[10px] text-gray-500 mt-3 flex items-center gap-1.5 opacity-80">
              <Info className="w-3 h-3" /> Select the folder containing <code>databases/invokeai.db</code>.
            </p>
          </div>

          <div className="pt-4 border-t border-black/5 dark:border-white/5 flex items-center justify-between">
            <button
              onClick={handleTestConnection}
              disabled={isTesting || !settings.invokeAiPath}
              className={`px-6 py-2.5 rounded-xl text-sm font-black tracking-wide transition-all flex items-center gap-2.5 ${!settings.invokeAiPath
                ? 'bg-gray-100 dark:bg-white/5 text-gray-400 cursor-not-allowed'
                : 'bg-sage-600 hover:bg-sage-500 text-white shadow-xl shadow-sage-500/20 active:scale-95'
                }`}
            >
              {isTesting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <Globe className="w-4 h-4" />
                  Test Connection
                </>
              )}
            </button>

            {testResult && (
              <div className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 animate-in fade-in slide-in-from-right-2 duration-300 ${testResult.success
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                }`}>
                {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {testResult.message}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm relative overflow-hidden group">
        <h4 className="text-[10px] font-black text-sage-600 dark:text-sage-400 uppercase tracking-[0.2em] mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-4 h-4" /> System Audit
          </div>
          <button
            type="button"
            onClick={runDiagnostics}
            disabled={isDiagLoading || !settings.invokeAiPath}
            className="text-[10px] bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 px-3 py-1.5 rounded-lg transition-all active:scale-95 font-black uppercase tracking-widest flex items-center gap-2 text-gray-600 dark:text-gray-300"
          >
            {isDiagLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <BarChart3 className="w-3 h-3" />}
            {isDiagLoading ? 'Analyzing...' : 'Run Audit'}
          </button>
        </h4>

        {!diagData ? (
          <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-white/[0.02] rounded-xl border border-gray-200 dark:border-white/5">
            <div className="p-3 bg-white dark:bg-white/5 rounded-xl shadow-sm">
              <Search className="w-5 h-5 text-gray-400" />
            </div>
            <div>
              <p className="text-xs font-bold text-gray-700 dark:text-gray-300">Ready for Scan</p>
              <p className="text-[10px] text-gray-500">Run an audit to compare database entries with local output files.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-top-2 relative z-10">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-sm group/stat">
                <div className="text-[9px] text-gray-500 dark:text-gray-400 uppercase font-black tracking-widest mb-1 flex items-center gap-2">
                  <Database className="w-3 h-3 text-sage-500" /> InvokeAI Database
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums drop-shadow-sm transition-transform group-hover/stat:scale-105 origin-left duration-500">{diagData.totalInDb.toLocaleString()}</div>
                <div className="text-[9px] text-gray-500 font-medium">Synced Records</div>
              </div>
              <div className="p-4 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-sm group/stat">
                <div className="text-[9px] text-gray-500 dark:text-gray-400 uppercase font-black tracking-widest mb-1 flex items-center gap-2">
                  <Files className="w-3 h-3 text-sage-500" /> Image Repository
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums drop-shadow-sm transition-transform group-hover/stat:scale-105 origin-left duration-500">{diagData.folder.imageFiles.toLocaleString()}</div>
                <div className="text-[10px] text-gray-500 font-medium">Files on Disk</div>
              </div>
            </div>

            {diagData.totalInDb !== diagData.folder.imageFiles && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-[11px] text-amber-700 dark:text-amber-400 shadow-lg shadow-amber-500/5">
                <div className="font-black uppercase tracking-widest flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  Count Discrepancy Found
                </div>
                <p className="opacity-90 leading-normal">
                  There are <strong>{Math.abs(diagData.totalInDb - diagData.folder.imageFiles).toLocaleString()}</strong> {diagData.totalInDb > diagData.folder.imageFiles ? 'extra records in the database' : 'extra files in the outputs folder'}.
                </p>
                {diagData.totalInDb > diagData.folder.imageFiles && (
                  <p className="mt-2 text-[10px] font-medium opacity-80 bg-black/5 dark:bg-white/5 p-2 rounded-lg">Recommended: Run "Reset Cursor" to re-validate image availability.</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-6 pt-2">
              <div className="space-y-3">
                <div className="text-[9px] text-gray-400 uppercase font-black tracking-widest px-1">Categories (DB)</div>
                <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-2 scrollbar-thin">
                  {diagData.categories.map((c: any) => (
                    <div key={c.image_category} className="flex justify-between text-[10px] p-2.5 bg-gray-100/50 dark:bg-white/[0.02] rounded-xl border border-gray-200 dark:border-white/5 transition-colors hover:bg-gray-200/50 dark:hover:bg-white/[0.05]">
                      <span className="text-gray-500 dark:text-gray-400 capitalize font-bold">{c.image_category}</span>
                      <span className="font-black text-gray-900 dark:text-white tabular-nums">{c.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-[9px] text-gray-400 uppercase font-black tracking-widest px-1">Origins (DB)</div>
                <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-2 scrollbar-thin">
                  {diagData.origins.map((o: any) => (
                    <div key={o.image_origin} className="flex justify-between text-[10px] p-2.5 bg-gray-100/50 dark:bg-white/[0.02] rounded-xl border border-gray-200 dark:border-white/5 transition-colors hover:bg-gray-200/50 dark:hover:bg-white/[0.05]">
                      <span className="text-gray-500 dark:text-gray-400 capitalize font-bold">{o.image_origin}</span>
                      <span className="font-black text-gray-900 dark:text-white tabular-nums">{o.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-black/5 dark:border-white/5 space-y-4">
              <div className="flex items-center justify-between px-1">
                <div className="text-[9px] text-gray-400 uppercase font-black tracking-widest">Storage Status</div>
                <div className="text-[9px] text-gray-500 font-medium italic">
                  {diagData.folder.thumbnailFiles.toLocaleString()} Thumbnails active
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {Object.entries(diagData.folder.subfolders || {}).map(([folder, count]: [any, any]) => (
                  <div key={folder} className="flex justify-between items-center text-[10px] p-2 bg-black/[0.02] dark:bg-white/[0.02] rounded-lg border border-transparent hover:border-black/5 dark:hover:border-white/5 transition-all">
                    <div className="flex items-center gap-2 min-w-0">
                      <FolderOpen className="w-3 h-3 text-gray-400 flex-shrink-0" />
                      <span className="text-gray-500 dark:text-gray-400 truncate font-mono">{folder}</span>
                    </div>
                    <span className="font-black text-gray-700 dark:text-gray-300 pl-2 tabular-nums">{count.toLocaleString()}</span>
                  </div>
                ))}
                {Object.keys(diagData.folder.subfolders || {}).length === 0 && (
                  <div className="col-span-2 text-[10px] text-gray-500 italic p-3 bg-black/5 dark:bg-black/20 rounded-xl text-center">Output repository is flat (no sub-collections found).</div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      <SyncSection settings={settings} setSettings={setSettings} />
    </div>
  );
});

// --- A1111 TAB ---

export const A1111Tab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [showAllFolders, setShowAllFolders] = useState(false);

  const handleDiscover = async () => {
    if (!settings.a1111Path) return;
    setIsScanning(true);
    setTestResult(null);
    try {
      const { discoverA1111Candidates } = await import('../../services/a1111/config');
      const existing = new Set(settings.monitoredFolders.map(f => f.path.toLowerCase().replace(/\\/g, '/')));
      const results: any[] = await discoverA1111Candidates(settings.a1111Path, existing);
      setCandidates(results);

      // Auto-select priority folders that aren't linked yet
      const priorityUnlinked = results.filter(c => c.isPriority && !c.isAlreadyLinked);
      setSelectedPaths(new Set(priorityUnlinked.map(c => c.path)));

      // If NO priority folders found, auto-show all
      if (priorityUnlinked.length === 0 && results.length > 0) {
        setShowAllFolders(true);
      }

      if (results.length === 0) {
        setTestResult({ success: false, message: "No potential folders containing images found." });
      }
    } catch (e) {
      console.error(e);
      setTestResult({ success: false, message: "Discovery failed. Check path permissions." });
    } finally {
      setIsScanning(false);
    }
  };

  const toggleSelection = (path: string) => {
    const next = new Set(selectedPaths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setSelectedPaths(next);
  };

  const handleLinkSelected = () => {
    const toLink = candidates.filter(c => selectedPaths.has(c.path));
    if (toLink.length === 0) return;

    setSettings(prev => {
      const newFolders = toLink.map(c => ({
        id: `a1111_${c.inferredType}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        path: c.path,
        isActive: true,
        imageCount: c.imageCount
      }));
      return {
        ...prev,
        monitoredFolders: [...prev.monitoredFolders, ...newFolders]
      };
    });
    setCandidates([]);
    setTestResult({ success: true, message: `Successfully linked ${toLink.length} folders!` });
  };

  const displayedCandidates = showAllFolders
    ? candidates
    : candidates.filter(c => c.isPriority);

  const hiddenCount = candidates.length - displayedCandidates.length;

  return (
    <div className="space-y-6 max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="px-1">
        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
          Stable Diffusion WebUI
        </h3>
        <p className="text-sm text-gray-500">
          Connect your A1111, Forge, or SD.Next installation and discover output folders.
        </p>
      </div>

      <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm relative overflow-hidden group">
        <h4 className="text-[10px] font-black text-white px-4 py-2 bg-sage-600 rounded-lg inline-flex items-center gap-3 mb-6 uppercase tracking-widest shadow-lg shadow-sage-500/20">
          <Palette className="w-4 h-4" /> Core Configuration
        </h4>

        <div className="space-y-6">
          <div className="relative">
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3 px-1">
              Installation or Archive Path
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative group">
                <input
                  type="text"
                  value={settings.a1111Path || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, a1111Path: e.target.value }))}
                  placeholder="e.g. C:\StableDiffusion or C:\MyArchive"
                  className="w-full bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:border-sage-500 focus:ring-1 focus:ring-sage-500/50 outline-none text-gray-900 dark:text-white font-mono transition-all"
                />
                <Folder className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-sage-500 transition-colors" />
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const { open } = await import('@tauri-apps/plugin-dialog');
                    const selected = await open({ directory: true, multiple: false, title: 'Select SD Folder' });
                    if (selected && typeof selected === 'string') {
                      const { normalizePath } = await import('../../utils/pathUtils');
                      setSettings(prev => ({ ...prev, a1111Path: normalizePath(selected) }));
                    }
                  } catch (e) { console.error(e); }
                }}
                className="px-4 py-2.5 bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-white/20 active:scale-95 transition-all text-sm font-bold"
              >
                Browse
              </button>
            </div>
            <p className="text-[10px] text-gray-500 mt-3 flex items-center gap-1.5 opacity-80 px-1">
              <Info className="w-3 h-3" /> Select the root of your SD installation or any folder with outputs.
            </p>
          </div>

          <div className="pt-6 border-t border-black/5 dark:border-white/5 flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <button
                onClick={handleDiscover}
                disabled={isScanning || !settings.a1111Path}
                className={`px-8 py-3 rounded-xl text-sm font-black tracking-wide transition-all flex items-center gap-2.5 ${!settings.a1111Path
                  ? 'bg-gray-100 dark:bg-white/5 text-gray-400 cursor-not-allowed'
                  : 'bg-sage-600 hover:bg-sage-500 text-white shadow-xl shadow-sage-500/20 active:scale-95'
                  }`}
              >
                {isScanning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <FolderSearch className="w-4 h-4" />
                    Scan for Folders
                  </>
                )}
              </button>

              {testResult && (
                <div className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 animate-in fade-in slide-in-from-right-2 duration-300 ${testResult.success
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                  }`}>
                  {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {testResult.message}
                </div>
              )}
            </div>

            {candidates.length > 0 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
                <div className="flex items-center justify-between px-1">
                  <div className="flex flex-col gap-1">
                    <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">Discovery Results</h5>
                    {!showAllFolders && hiddenCount > 0 && (
                      <span className="text-[9px] text-gray-500 font-medium">Showing standard output folders ({displayedCandidates.length} of {candidates.length})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    {candidates.length > displayedCandidates.length || showAllFolders ? (
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <span className="text-[10px] font-bold text-gray-500 group-hover:text-sage-600 transition-colors uppercase tracking-tight">Show non-standard folders</span>
                        <div
                          onClick={() => setShowAllFolders(!showAllFolders)}
                          className={`w-8 h-4 rounded-full relative transition-colors ${showAllFolders ? 'bg-sage-500' : 'bg-gray-300 dark:bg-white/10'}`}
                        >
                          <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${showAllFolders ? 'left-[17px]' : 'left-0.5'}`} />
                        </div>
                      </label>
                    ) : null}
                    <span className="text-[10px] font-bold text-sage-600 bg-sage-500/10 px-2 py-0.5 rounded-full">{displayedCandidates.length} found</span>
                  </div>
                </div>

                <div className="border border-black/5 dark:border-white/10 rounded-2xl overflow-hidden bg-gray-50/50 dark:bg-black/20">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-black/5 dark:border-white/5 bg-gray-100/50 dark:bg-white/5">
                        <th className="px-4 py-3 text-[9px] font-black text-gray-400 uppercase tracking-widest w-10">Link</th>
                        <th className="px-4 py-3 text-[9px] font-black text-gray-400 uppercase tracking-widest">Folder Name / Path</th>
                        <th className="px-4 py-3 text-[9px] font-black text-gray-400 uppercase tracking-widest w-32">Type</th>
                        <th className="px-4 py-3 text-[9px] font-black text-gray-400 uppercase tracking-widest w-24 text-right">Images</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 dark:divide-white/5">
                      {displayedCandidates.map((c) => (
                        <tr key={c.path} className={`group hover:bg-white/50 dark:hover:bg-white/[0.03] transition-colors ${c.isAlreadyLinked ? 'opacity-40 grayscale' : ''}`}>
                          <td className="px-4 py-3">
                            <label className="flex items-center justify-center cursor-pointer">
                              <div className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all relative ${selectedPaths.has(c.path) ? 'bg-sage-600 border-sage-600 shadow-lg shadow-sage-500/30' : 'border-gray-300 dark:border-white/20 bg-white/5'}`}>
                                {selectedPaths.has(c.path) && <div className="w-2 h-2 bg-white rounded-sm" />}
                                <input
                                  type="checkbox"
                                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                                  checked={selectedPaths.has(c.path)}
                                  onChange={() => !c.isAlreadyLinked && toggleSelection(c.path)}
                                  disabled={c.isAlreadyLinked}
                                />
                              </div>
                            </label>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                                <Folder className="w-3.5 h-3.5 text-gray-400" />
                                {c.name}
                                {c.isAlreadyLinked && <span className="text-[8px] bg-gray-200 dark:bg-white/10 text-gray-500 px-1.5 py-0.5 rounded uppercase font-black">Linked</span>}
                              </span>
                              <span className="text-[10px] text-gray-500 font-mono truncate max-w-md opacity-60">
                                {c.path.replace(settings.a1111Path || '', '...')}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={c.inferredType}
                              onChange={(e) => {
                                const newCandidates = candidates.map(cand =>
                                  cand.path === c.path ? { ...cand, inferredType: e.target.value } : cand
                                );
                                setCandidates(newCandidates);
                              }}
                              className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-white/10 rounded-lg text-xs font-bold py-1 px-2 outline-none focus:ring-1 focus:ring-sage-500/30"
                            >
                              <option value="txt2img">txt2img</option>
                              <option value="img2img">img2img</option>
                              <option value="extras">Extras</option>
                              <option value="grid">Grids</option>
                              <option value="unknown">Unknown</option>
                            </select>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-xs font-bold text-gray-500 dark:text-gray-400 font-mono tabular-nums">
                              {c.imageCount.toLocaleString()}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={handleLinkSelected}
                    disabled={selectedPaths.size === 0}
                    className={`px-8 py-2.5 rounded-xl text-sm font-black transition-all flex items-center gap-2.5 ${selectedPaths.size === 0
                      ? 'bg-gray-100 dark:bg-white/5 text-gray-400 cursor-not-allowed'
                      : 'bg-sage-600 hover:bg-sage-500 text-white shadow-xl shadow-sage-500/20 active:scale-95'
                      }`}
                  >
                    <Plus className="w-4 h-4" />
                    Link {selectedPaths.size} Folders
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
});

// Sub-component for Sync Logic
const SyncSection: React.FC<{ settings: AppSettings, setSettings: React.Dispatch<React.SetStateAction<AppSettings>> }> = React.memo(({ settings, setSettings }) => {
  const { syncState, startInvokeSync, cancelSync, cleanLibrary } = useLibrary();
  const { status, progress } = syncState;

  // Local state for sync options
  const [syncFavorites, setSyncFavorites] = useState(true);
  const [syncBoards, setSyncBoards] = useState(true);
  const [confirmAction, setConfirmAction] = useState<{ type: 'reset' | 'purge' | null, isOpen: boolean }>({ type: null, isOpen: false });

  const closeConfirm = () => setConfirmAction({ type: null, isOpen: false });

  const handleSync = () => {
    if (!settings.invokeAiPath) return;
    startInvokeSync({
      syncFavorites,
      syncBoards,
      importIntermediates: settings.importIntermediates,
      afterTimestamp: settings.lastSyncedAt,
      starredAs: settings.starredAs
    });
  };

  if (!settings.invokeAiPath) return null;

  return (
    <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm relative overflow-hidden group">
      <h4 className="text-[10px] font-black text-sage-600 dark:text-sage-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
        <RefreshCw className="w-4 h-4" /> Synchronization
      </h4>

      <div className="mb-8 space-y-6 relative z-10">
        <p className="text-sm text-gray-500 font-medium">
          Automate the bridge between InvokeAI and your Ambit library.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Favorites Group */}
          <div className={`p-4 rounded-xl border transition-all duration-300 ${syncFavorites ? 'bg-sage-50 dark:bg-sage-500/5 border-sage-500/20' : 'bg-transparent border-gray-100 dark:border-white/5 opacity-60'}`}>
            <label className="flex items-center gap-3 cursor-pointer group/label mb-3">
              <div className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all relative ${syncFavorites ? 'bg-sage-600 border-sage-600 shadow-lg shadow-sage-500/30' : 'border-gray-300 dark:border-white/20 bg-white/5'}`}>
                {syncFavorites && <div className="w-2 h-2 bg-white rounded-sm" />}
                <input type="checkbox" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" checked={syncFavorites} onChange={e => setSyncFavorites(e.target.checked)} />
              </div>
              <span className="text-sm font-bold text-gray-700 dark:text-gray-200">Sync Favorites</span>
            </label>

            {syncFavorites && (
              <div className="pl-8 animate-in fade-in slide-in-from-left-2 duration-300">
                <div className="flex items-center gap-3 p-2 bg-white/50 dark:bg-black/20 rounded-xl border border-black/5 dark:border-white/5">
                  <span className="text-[10px] uppercase font-black text-gray-400 tracking-tighter">Map to</span>
                  <select
                    value={settings.starredAs || 'favorite'}
                    onChange={(e) => setSettings(prev => ({ ...prev, starredAs: e.target.value as any }))}
                    className="flex-1 bg-gray-100 dark:bg-zinc-800 text-xs font-bold outline-none text-sage-600 dark:text-sage-300 cursor-pointer py-1.5 px-2 rounded-lg"
                  >
                    <option value="favorite">Favorites</option>
                    <option value="pin">Pins</option>
                    <option value="both">Both</option>
                    <option value="none">None (Ignore)</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Boards Group */}
          <div className={`p-4 rounded-xl border transition-all duration-300 ${syncBoards ? 'bg-sage-50 dark:bg-sage-500/5 border-sage-500/20' : 'bg-transparent border-gray-100 dark:border-white/5 opacity-60'}`}>
            <label className="flex items-center gap-3 cursor-pointer group/label mb-3">
              <div className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all relative ${syncBoards ? 'bg-sage-600 border-sage-600 shadow-lg shadow-sage-500/30' : 'border-gray-300 dark:border-white/20 bg-white/5'}`}>
                {syncBoards && <div className="w-2 h-2 bg-white rounded-sm" />}
                <input type="checkbox" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" checked={syncBoards} onChange={e => setSyncBoards(e.target.checked)} />
              </div>
              <span className="text-sm font-bold text-gray-700 dark:text-gray-200">Sync Boards</span>
            </label>

            {syncBoards && (
              <div className="pl-8 animate-in fade-in slide-in-from-left-2 duration-300">
                <label className="flex items-center gap-2 cursor-pointer group/sub">
                  <div className={`w-8 h-4 rounded-full relative transition-colors ${settings.syncBoardsToCollections ? 'bg-sage-600' : 'bg-gray-300 dark:bg-white/10'}`}>
                    <input type="checkbox" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" checked={settings.syncBoardsToCollections || false} onChange={e => setSettings(prev => ({ ...prev, syncBoardsToCollections: e.target.checked }))} />
                    <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full pointer-events-none transition-transform ${settings.syncBoardsToCollections ? 'translate-x-4' : 'translate-x-0'}`} />
                  </div>
                  <span className="text-[10px] font-bold text-gray-500 group-hover/sub:text-sage-600 transition-colors">Persistent Collections</span>
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Advanced Options */}
        <div className="p-5 bg-black/[0.03] dark:bg-black/20 rounded-2xl border border-black/5 dark:border-white/5 space-y-4">
          <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1">Advanced Control</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <label className="flex items-start gap-3 cursor-pointer group/toggle">
              <div className={`mt-1 w-10 h-5 rounded-full relative transition-colors shrink-0 ${settings.importIntermediates ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}>
                <input type="checkbox" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" checked={settings.importIntermediates || false} onChange={e => setSettings(prev => ({ ...prev, importIntermediates: e.target.checked }))} />
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full pointer-events-none transition-transform ${settings.importIntermediates ? 'translate-x-5' : 'translate-x-0'}`} />
              </div>
              <div>
                <span className="text-[11px] font-bold text-gray-700 dark:text-gray-200 block">Import Intermediates</span>
                <span className="text-[9px] text-gray-500 leading-tight">Sync background generation steps.</span>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group/toggle">
              <div className={`mt-1 w-10 h-5 rounded-full relative transition-colors shrink-0 ${settings.importOrphans !== false ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}>
                <input type="checkbox" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" checked={settings.importOrphans !== false} onChange={e => setSettings(prev => ({ ...prev, importOrphans: e.target.checked }))} />
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full pointer-events-none transition-transform ${settings.importOrphans !== false ? 'translate-x-5' : 'translate-x-0'}`} />
              </div>
              <div>
                <span className="text-[11px] font-bold text-gray-700 dark:text-gray-200 block">Orphan Recovery</span>
                <span className="text-[9px] text-gray-500 leading-tight">Find untracked files in output folder.</span>
              </div>
            </label>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 relative z-10">
        <div className="flex items-center justify-between">
          {status === 'idle' || status === 'error' || status === 'complete' ? (
            <div className="flex items-center gap-3">
              <button
                onClick={handleSync}
                className="px-8 py-3 bg-sage-600 hover:bg-sage-500 text-white rounded-xl text-sm font-black transition-all shadow-xl shadow-sage-500/20 active:scale-95 flex items-center gap-3"
              >
                {status === 'error' ? <ZapOff className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
                {status === 'error' ? 'Retry Sync' : 'Initiate Sync'}
              </button>

              <div className="flex items-center p-1 bg-black/5 dark:bg-white/5 rounded-xl border border-black/5 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => setConfirmAction({ type: 'reset', isOpen: true })}
                  className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-sage-600 transition-colors flex items-center gap-2"
                >
                  <History className="w-3 h-3" /> Reset Cursor
                </button>
                <div className="w-px h-3 bg-black/10 dark:bg-white/10 mx-1"></div>
                <button
                  type="button"
                  onClick={() => setConfirmAction({ type: 'purge', isOpen: true })}
                  className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-rose-500 hover:text-rose-700 transition-colors flex items-center gap-2"
                >
                  <Trash2 className="w-3 h-3" /> Purge Database
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={cancelSync}
              className="px-6 py-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-xl text-sm font-black transition-all flex items-center gap-3 active:scale-95"
            >
              <XCircle className="w-5 h-5" /> Terminate Sync
            </button>
          )}
        </div>

        <ConfirmDialog
          isOpen={confirmAction.isOpen && confirmAction.type === 'reset'}
          title="Reset Sync Cursor?"
          message={`This will reset the "Last Synced" timestamp. The next sync operation will scan your ENTIRE InvokeAI library from the beginning. This process may take some time.`}
          confirmLabel="Reset Cursor"
          onConfirm={() => {
            setSettings(p => ({ ...p, lastSyncedAt: null }));
            closeConfirm();
          }}
          onCancel={closeConfirm}
          zIndex={220}
        />

        <ConfirmDialog
          isOpen={confirmAction.isOpen && confirmAction.type === 'purge'}
          title="Purge Application Database?"
          message="DANGER: This will delete ALL images and metadata from your Ambit library. Your actual image files on disk will NOT be touched, but you will lose all Ambit-specific data (collections, tags, favorites). Are you sure?"
          confirmLabel="Purge Database"
          isDangerous={true}
          onConfirm={() => {
            cleanLibrary();
            closeConfirm();
          }}
          onCancel={closeConfirm}
          zIndex={220}
        />

        {status === 'syncing' && (
          <div className="p-5 bg-sage-50 dark:bg-sage-500/5 rounded-xl border border-sage-500/10 space-y-3 animate-in fade-in zoom-in-95 duration-500">
            <div className="flex justify-between items-end">
              <div>
                <div className="text-[10px] font-black text-sage-600 dark:text-sage-400 uppercase tracking-[0.2em] mb-1">{progress.message || 'Processing...'}</div>
                <div className="text-xs text-gray-500 font-medium">Synchronizing InvokeAI repository...</div>
              </div>
              <div className="text-xl font-black text-gray-900 dark:text-white font-mono tabular-nums">
                {Math.round((progress.current / Math.max(progress.total, 1)) * 100)}<span className="text-xs opacity-40 ml-0.5">%</span>
              </div>
            </div>
            <div className="w-full h-3 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden p-0.5 border border-gray-200 dark:border-white/5 relative ring-1 ring-sage-500/10 animate-pulse-glow">
              <div
                className="h-full bg-sage-500 rounded-full transition-all duration-500 ease-out shadow-[0_0_15px_rgba(110,121,107,0.3)] relative overflow-hidden"
                style={{ width: `${Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%` }}
              >
                {/* Pulsing shimmer effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent w-full animate-shimmer"
                  style={{ backgroundSize: '200% 100%' }} />
              </div>
            </div>
            <div className="flex justify-between text-[10px] font-bold text-gray-400 tabular-nums">
              <span className="flex items-center gap-2"><Boxes className="w-3 h-3" /> {progress.current.toLocaleString()} units</span>
              <span>Total: {progress.total.toLocaleString()}</span>
            </div>
          </div>
        )}

        {status === 'complete' && (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-[11px] font-bold text-emerald-600 dark:text-emerald-400 animate-in fade-in slide-in-from-top-2 flex items-center gap-3 shadow-lg shadow-emerald-500/5">
            <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/40 text-white">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <div className="uppercase tracking-widest text-[9px] mb-0.5">Library Updated</div>
              Repository successfully synchronized with Ambit.
            </div>
          </div>
        )}
      </div>
    </section>
  );
});