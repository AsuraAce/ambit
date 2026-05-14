import { commands, type Result } from '../bindings';
import { isBrowserMockMode } from './runtime';

export const OS_OPEN_BROWSER_UNAVAILABLE_MESSAGE = 'Unavailable in browser mock mode.';

export const isOsOpenUnavailable = (error: string): boolean =>
    error === OS_OPEN_BROWSER_UNAVAILABLE_MESSAGE;

export const openFileInDefaultApp = async (path: string): Promise<Result<null, string>> => {
    if (isBrowserMockMode()) {
        return { status: 'error', error: OS_OPEN_BROWSER_UNAVAILABLE_MESSAGE };
    }

    return runOsOpenCommand(() => commands.openFile(path));
};

export const showPathInFolder = async (path: string): Promise<Result<null, string>> => {
    if (isBrowserMockMode()) {
        return { status: 'error', error: OS_OPEN_BROWSER_UNAVAILABLE_MESSAGE };
    }

    return runOsOpenCommand(() => commands.showInFolder(path));
};

const runOsOpenCommand = async (
    command: () => Promise<Result<null, string>>
): Promise<Result<null, string>> => {
    try {
        return await command();
    } catch (error) {
        return {
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
        };
    }
};
