import { startStartupHeartbeat, startupDiagnostics } from './utils/startupDiagnostics';

type ApplicationLoader = () => Promise<unknown>;

const loadApplication = () => import('./index');

export const startApplication = (load: ApplicationLoader = loadApplication) => {
    void load().catch(() => {
        window.__AMBIT_STARTUP_BOOTSTRAP__?.showFailure?.();
        startupDiagnostics.fail('startup-failure', 'script-load');
    });
};

void startupDiagnostics.connect().then(() => {
    if (!startupDiagnostics.getLaunchId()) {
        window.__AMBIT_STARTUP_BOOTSTRAP__?.markTransportUnavailable();
    }
});

startupDiagnostics.mark('frontend-entry');
startStartupHeartbeat();
startApplication();
