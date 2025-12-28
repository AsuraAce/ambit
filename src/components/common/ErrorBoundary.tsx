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
        error: null
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
                <div style={{
                    padding: '20px',
                    backgroundColor: 'rgba(255,0,0,0.1)',
                    border: '1px solid red',
                    borderRadius: '8px',
                    margin: '10px',
                    color: '#ff4444'
                }}>
                    <h2>Something went wrong in this section.</h2>
                    <details style={{ whiteSpace: 'pre-wrap', marginTop: '10px', fontSize: '12px', opacity: 0.8 }}>
                        {this.state.error && this.state.error.toString()}
                    </details>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        style={{
                            marginTop: '15px',
                            padding: '8px 16px',
                            backgroundColor: '#444',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
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
