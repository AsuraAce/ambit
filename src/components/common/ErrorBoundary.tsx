import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback;

            return (
                <div
                    style={{
                        padding: '20px',
                        backgroundColor: 'var(--error-fallback-surface)',
                        border: '1px solid var(--error-fallback-border)',
                        borderRadius: '8px',
                        margin: '10px',
                        color: 'var(--error-fallback-text)',
                    }}
                >
                    <h2>Something went wrong in this section.</h2>
                    <details style={{ whiteSpace: 'pre-wrap', marginTop: '10px', fontSize: '12px', opacity: 0.8 }}>
                        {this.state.error && this.state.error.toString()}
                    </details>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        style={{
                            marginTop: '15px',
                            padding: '8px 16px',
                            backgroundColor: 'var(--error-fallback-button)',
                            color: 'var(--error-fallback-button-text)',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                        }}
                    >
                        Try again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
