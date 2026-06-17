import * as React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { ToastProvider } from './contexts/ToastContext';
import { LibraryProvider } from './contexts/LibraryContext';
import { StartupMaintenanceGate } from './components/StartupMaintenanceGate';

import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
root.render(
  <React.StrictMode>
    <ToastProvider>
      <QueryClientProvider client={queryClient}>
        <StartupMaintenanceGate>
          <LibraryProvider>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </LibraryProvider>
        </StartupMaintenanceGate>
        {import.meta.env.DEV && (
          <React.Suspense fallback={null}>
            <ReactQueryDevtools initialIsOpen={false} />
          </React.Suspense>
        )}
      </QueryClientProvider>
    </ToastProvider>
  </React.StrictMode>
);
