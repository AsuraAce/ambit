import * as React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { ToastProvider } from './contexts/ToastContext';
import { LibraryProvider } from './contexts/LibraryContext';
import { StartupMaintenanceGate } from './components/StartupMaintenanceGate';
import { StartupBoundary } from './components/StartupBoundary';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isCaptureMode } from './utils/buildFlags';
import { markReactMounted } from './utils/startupDiagnostics';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 60,
      refetchOnWindowFocus: false,
      retry: 1
    },
  },
});

const ReactQueryDevtools = React.lazy(() =>
  import('@tanstack/react-query-devtools').then(({ ReactQueryDevtools }) => ({
    default: ReactQueryDevtools
  }))
);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

const StartupMountMarker = () => {
  React.useEffect(() => {
    markReactMounted();
  }, []);
  return null;
};

root.render(
  <React.StrictMode>
    <StartupBoundary>
      <StartupMountMarker />
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <StartupMaintenanceGate>
            <LibraryProvider>
              <App />
            </LibraryProvider>
          </StartupMaintenanceGate>
          {import.meta.env.DEV && !isCaptureMode() && (
            <React.Suspense fallback={null}>
              <ReactQueryDevtools initialIsOpen={false} />
            </React.Suspense>
          )}
        </QueryClientProvider>
      </ToastProvider>
    </StartupBoundary>
  </React.StrictMode>
);
