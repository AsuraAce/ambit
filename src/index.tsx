import * as React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { ToastProvider } from './contexts/ToastContext';
import { LibraryProvider } from './contexts/LibraryContext';

import { ErrorBoundary } from './components/ErrorBoundary';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ToastProvider>
      <LibraryProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </LibraryProvider>
    </ToastProvider>
  </React.StrictMode>
);