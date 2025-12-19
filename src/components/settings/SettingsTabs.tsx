import * as React from 'react';
import { useRef, useState } from 'react';
import { Monitor, Folder, Plus, Trash2, FolderSearch, AlertTriangle, Shield, Eye, Lock, FlaskConical, Clock, Zap, Palette, Save, Loader2, XCircle, Moon, Sun, Key } from 'lucide-react';
import { useLibrary } from '../../contexts/LibraryContext';
import { AppSettings, MonitoredFolder } from '../../types';

interface TabProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

// --- GENERAL TAB ---
export const GeneralTab: React.FC<TabProps> = ({ settings, setSettings }) => (
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
    </section>
  </div>
);

// --- FOLDERS TAB ---
export const FoldersTab: React.FC<TabProps> = ({ settings, setSettings }) => {
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
        // In Tauri v2, opening a directory grants permission scope for it automatically (usually)
        setNewFolderPath(normalizePath(selected));
      }
    } catch (e) {
      // Fallback for Web Demo / Dev mode if plugin missing
      console.warn('Native dialog failed, falling back to input', e);
      fileInputRef.current?.click();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      // WEB FALLBACK: Still use the fake path for purely web demo visualization
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
};

// --- PRIVACY TAB ---
export const PrivacyTab: React.FC<TabProps> = ({ settings, setSettings }) => {
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
};

// --- EXPERIMENTS TAB ---
export const ExperimentsTab: React.FC<TabProps> = ({ settings, setSettings }) => {
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
};

// --- INTEGRATIONS TAB ---
export const IntegrationsTab: React.FC<TabProps> = ({ settings, setSettings }) => {
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const handleTestConnection = async () => {
    if (!settings.invokeAiPath) return;
    setIsTesting(true);
    setTestResult(null);

    try {
      const { testConnection } = await import('../../services/invokeService');
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
        // We might want to normalize path
        // const { normalizePath } = await import('../../utils/pathUtils');
        // setSettings(prev => ({ ...prev, invokeAiPath: normalizePath(selected) }));
        setSettings(prev => ({ ...prev, invokeAiPath: selected }));
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
      <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-6 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-500"></div> InvokeAI Integration
        </h4>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-gray-900 dark:text-white mb-2">
              Root Folder Path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={settings.invokeAiPath || ''}
                onChange={(e) => setSettings(prev => ({ ...prev, invokeAiPath: e.target.value }))}
                placeholder="e.g. C:\Users\Name\invokeai"
                className="flex-1 bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-sage-500 outline-none text-gray-900 dark:text-white font-mono"
              />
              <button
                type="button"
                onClick={handleBrowse}
                className="px-3 py-2 bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-white/20 transition-colors text-sm font-medium"
              >
                Browse
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Select the folder containing <code>databases/invokeai.db</code>.
            </p>
          </div>

          <div className="pt-2 border-t border-gray-100 dark:border-white/5 mt-4">
            <button
              onClick={handleTestConnection}
              disabled={isTesting || !settings.invokeAiPath}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${!settings.invokeAiPath
                ? 'bg-gray-100 dark:bg-white/5 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20'
                }`}
            >
              {isTesting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Connecting...
                </>
              ) : (
                'Test Connection'
              )}
            </button>

            {testResult && (
              <div className={`mt-3 p-3 rounded-lg text-sm flex items-start gap-2 ${testResult.success
                ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800/30'
                : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800/30'
                }`}>
                <div className={`mt-0.5 w-2 h-2 rounded-full ${testResult.success ? 'bg-green-500' : 'bg-red-500'}`} />
                {testResult.message}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Sync Logic Section */}
      <SyncSection settings={settings} setSettings={setSettings} />
    </div>
  );
};

// Sub-component for Sync Logic
const SyncSection: React.FC<{ settings: AppSettings, setSettings: React.Dispatch<React.SetStateAction<AppSettings>> }> = ({ settings, setSettings }) => {
  const { syncState, startInvokeSync, cancelSync } = useLibrary();
  const { status, progress } = syncState;

  // Local state for sync options
  const [syncFavorites, setSyncFavorites] = useState(true);
  const [syncBoards, setSyncBoards] = useState(true);

  const handleSync = () => {
    if (!settings.invokeAiPath) return;
    startInvokeSync(settings.invokeAiPath, { syncFavorites, syncBoards, afterTimestamp: settings.lastSyncedAt });
  };

  if (!settings.invokeAiPath) return null;

  return (
    <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Synchronization</h4>

      <div className="mb-6 space-y-3">
        <div className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          Sync images from InvokeAI to your Ambit library.
        </div>

        <div className="flex gap-6">
          <label className="flex items-center gap-2 cursor-pointer group">
            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${syncFavorites ? 'bg-sage-600 border-sage-600' : 'border-gray-300 dark:border-white/20'}`}>
              {syncFavorites && <div className="w-2 h-2 bg-white rounded-sm" />}
              <input
                type="checkbox"
                className="hidden"
                checked={syncFavorites}
                onChange={e => setSyncFavorites(e.target.checked)}
              />
            </div>
            <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-sage-500 transition-colors">Sync Favorites</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer group">
            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${syncBoards ? 'bg-sage-600 border-sage-600' : 'border-gray-300 dark:border-white/20'}`}>
              {syncBoards && <div className="w-2 h-2 bg-white rounded-sm" />}
              <input
                type="checkbox"
                className="hidden"
                checked={syncBoards}
                onChange={e => setSyncBoards(e.target.checked)}
              />
            </div>
            <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-sage-500 transition-colors">Sync Boards (Collections)</span>
          </label>
        </div>

        {syncBoards && (
          <div className="pt-2 animate-in fade-in slide-in-from-top-1">
            <label className="flex items-center gap-2 cursor-pointer group">
              <div className={`w-12 h-6 rounded-full relative transition-colors ${settings.syncBoardsToCollections ? 'bg-blue-600' : 'bg-gray-200 dark:bg-white/10'}`}>
                <input
                  type="checkbox"
                  className="hidden"
                  checked={settings.syncBoardsToCollections || false}
                  onChange={e => setSettings(prev => ({ ...prev, syncBoardsToCollections: e.target.checked }))}
                />
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${settings.syncBoardsToCollections ? 'left-7' : 'left-1'}`} />
              </div>
              <div className="flex-1">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300 group-hover:text-blue-500 transition-colors">Convert Boards to Permanent Collections</span>
                <p className="text-[10px] text-gray-500">Allows renaming and customizing board-derived collections in Ambit.</p>
              </div>
            </label>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        {status === 'idle' || status === 'error' || status === 'complete' ? (
          <div className="flex items-center gap-3">
            <button
              onClick={handleSync}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-blue-500/20"
            >
              {status === 'error' ? 'Retry Sync' : 'Sync Now'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm("Reset sync progress? Next sync will scan ALL images from the beginning. This can take a while.")) {
                  setSettings(p => ({ ...p, lastSyncedAt: undefined }));
                }
              }}
              className="px-3 py-2 text-xs font-bold text-gray-500 hover:text-red-500 transition-colors"
            >
              Reset Cursor
            </button>
          </div>
        ) : (
          <button
            onClick={cancelSync}
            className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/30 dark:text-red-300 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <XCircle className="w-4 h-4" /> Stop
          </button>
        )}
      </div>

      {status === 'syncing' && (
        <div className="mt-4 space-y-2">
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>Importing...</span>
            <span>{progress.current} / {progress.total} ({Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%)</span>
          </div>
          <div className="w-full h-2 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300 ease-out"
              style={{ width: `${Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {status === 'complete' && (
        <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 rounded-lg text-sm flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          Sync Complete! Library refreshed.
        </div>
      )}

      {status === 'error' && (
        <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 rounded-lg text-sm">
          Sync failed. Check console for details.
        </div>
      )}
    </section>
  );
};