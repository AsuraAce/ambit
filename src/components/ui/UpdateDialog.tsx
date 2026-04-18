import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Download, Loader2, RefreshCw, X } from 'lucide-react';
import { AppUpdaterStatus } from '../../hooks/useAppUpdater';

interface UpdateDialogProps {
  availableVersion: string;
  currentVersion: string | null;
  errorMessage: string | null;
  isOpen: boolean;
  notes?: string | null;
  publishedAt?: string | null;
  status: AppUpdaterStatus;
  onClose: () => void;
  onInstall: () => Promise<void>;
}

const formatPublishedDate = (publishedAt?: string | null) => {
  if (!publishedAt) {
    return null;
  }

  const parsedDate = new Date(publishedAt);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsedDate);
};

export const UpdateDialog: React.FC<UpdateDialogProps> = ({
  availableVersion,
  currentVersion,
  errorMessage,
  isOpen,
  notes,
  publishedAt,
  status,
  onClose,
  onInstall,
}) => {
  const isBusy = status === 'downloading' || status === 'installing';
  const publishedLabel = formatPublishedDate(publishedAt);

  const installLabel =
    status === 'downloading'
      ? 'Downloading update...'
      : status === 'installing'
        ? 'Installing update...'
        : 'Download and Install';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[230] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-md"
        >
          <div className="absolute inset-0" onClick={!isBusy ? onClose : undefined} />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-white/95 shadow-[0_32px_80px_-20px_rgba(15,23,42,0.45)] dark:bg-slate-900/95"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="h-1.5 w-full bg-gradient-to-r from-sage-500 via-emerald-500 to-teal-500" />

            <div className="p-8">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="rounded-2xl bg-sage-50 p-3 text-sage-600 shadow-sm dark:bg-sage-500/10 dark:text-sage-300">
                    {isBusy ? <RefreshCw className="h-6 w-6 animate-spin" /> : <Download className="h-6 w-6" />}
                  </div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-sage-600 dark:text-sage-300">Update Available</p>
                    <h3 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                      Ambit {availableVersion}
                    </h3>
                    <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      A newer build is ready to install. After you confirm, Ambit will download the update and then restart or close to finish the installation.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  disabled={isBusy}
                  className={`rounded-full p-2 text-slate-400 transition-colors hover:bg-black/5 hover:text-slate-700 dark:hover:bg-white/5 dark:hover:text-white ${isBusy ? 'pointer-events-none opacity-0' : ''}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/5">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Current</div>
                  <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">{currentVersion ?? 'Loading...'}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/5">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Available</div>
                  <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">{availableVersion}</div>
                  {publishedLabel && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Published {publishedLabel}</div>}
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    Windows installers may close the app automatically while the update is applied. macOS and Linux typically restart after the install completes.
                  </p>
                </div>
              </div>

              <div className="mt-6">
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Release Notes</div>
                <div className="mt-2 max-h-56 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm leading-relaxed text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                  {notes && notes.trim().length > 0 ? (
                    <pre className="whitespace-pre-wrap font-sans">{notes.trim()}</pre>
                  ) : (
                    <p>No release notes were included with this update.</p>
                  )}
                </div>
              </div>

              {errorMessage && (
                <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-800 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-100">
                  {errorMessage}
                </div>
              )}

              <div className="mt-8 flex flex-col gap-3 sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={() => void onInstall()}
                  disabled={isBusy}
                  className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-bold text-white shadow-lg transition-all sm:w-auto ${isBusy ? 'cursor-wait bg-slate-500' : 'bg-gradient-to-br from-sage-500 to-emerald-600 hover:shadow-sage-500/30'}`}
                >
                  {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {installLabel}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isBusy}
                  className={`inline-flex w-full items-center justify-center rounded-2xl px-5 py-3 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-white sm:w-auto ${isBusy ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  Later
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
