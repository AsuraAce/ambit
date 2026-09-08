import * as React from 'react';
import { startupDiagnostics } from '../utils/startupDiagnostics';

interface StartupBoundaryProps {
    children: React.ReactNode;
}

interface StartupBoundaryState {
    hasError: boolean;
    launchId: string | null;
    startupComplete: boolean;
}

export class StartupBoundary extends React.Component<StartupBoundaryProps, StartupBoundaryState> {
    public state: StartupBoundaryState = {
        hasError: false,
        launchId: startupDiagnostics.getLaunchId(),
        startupComplete: false,
    };

    private unsubscribeLaunchId: (() => void) | undefined;
    private unsubscribeMarks: (() => void) | undefined;

    static getDerivedStateFromError(): Partial<StartupBoundaryState> {
        return { hasError: true };
    }

    componentDidMount() {
        this.unsubscribeLaunchId = startupDiagnostics.subscribe(launchId => this.setState({ launchId }));
        this.unsubscribeMarks = startupDiagnostics.subscribeMarks(phase => {
            if (phase === 'ready') this.setState({ startupComplete: true });
        });
    }

    componentDidCatch() {
        if (this.state.startupComplete) return;
        window.__AMBIT_STARTUP_BOOTSTRAP__?.showFailure();
        startupDiagnostics.fail('startup-failure', 'render-error');
    }

    componentWillUnmount() {
        this.unsubscribeLaunchId?.();
        this.unsubscribeMarks?.();
    }

    private handleRetry = () => this.setState({ hasError: false });

    render() {
        if (!this.state.hasError) return this.props.children;

        if (this.state.startupComplete) {
            return (
                <main
                    className="flex min-h-screen items-center justify-center bg-zinc-950 p-8 text-center text-zinc-100"
                    role="alert"
                >
                    <div className="max-w-md space-y-3">
                        <h1 className="text-xl font-semibold">Something went wrong</h1>
                        <p className="text-sm text-zinc-300">Ambit was already open, but this view stopped rendering.</p>
                        <button
                            type="button"
                            className="rounded-lg bg-sage-600 px-4 py-2 text-sm font-medium text-white hover:bg-sage-500"
                            onClick={this.handleRetry}
                        >
                            Try Again
                        </button>
                    </div>
                </main>
            );
        }

        return (
            <main
                className="flex min-h-screen items-center justify-center bg-zinc-950 p-8 text-center text-zinc-100"
                role="alert"
                style={{ position: 'fixed', inset: 0, zIndex: 2147483647 }}
            >
                <div className="max-w-md space-y-3">
                    <h1 className="text-xl font-semibold">Ambit couldn’t start</h1>
                    <p className="text-sm text-zinc-300">Restart Ambit. If the problem continues, share this launch ID with support.</p>
                    <p className="font-mono text-xs text-zinc-400">Launch ID: {this.state.launchId ?? 'unavailable'}</p>
                </div>
            </main>
        );
    }
}
