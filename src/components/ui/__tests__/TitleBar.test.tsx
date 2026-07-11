import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TitleBar } from '../TitleBar';

const runtimeState = vi.hoisted(() => ({ tauri: true }));
const settingsState = vi.hoisted(() => ({ developer: true }));

vi.mock('../../../services/runtime', () => ({ isTauriRuntime: () => runtimeState.tauri }));
vi.mock('../../../stores/settingsStore', () => ({
    useSettingsStore: (selector: (state: { settings: object }) => unknown) => selector({ settings: {} }),
}));
vi.mock('../../../utils/settingsUtils', () => ({ areDeveloperFeaturesEnabled: () => settingsState.developer }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));

const mockedGetCurrentWindow = vi.mocked(getCurrentWindow);

const createWindow = () => {
    let resizeHandler: (() => Promise<void>) | undefined;
    const win = {
        setIcon: vi.fn().mockResolvedValue(undefined),
        isMaximized: vi.fn().mockResolvedValue(false),
        isFullscreen: vi.fn().mockResolvedValue(false),
        setFullscreen: vi.fn().mockResolvedValue(undefined),
        listen: vi.fn().mockImplementation(async (_event: string, handler: () => Promise<void>) => {
            resizeHandler = handler;
            return unlisten;
        }),
        minimize: vi.fn(),
        maximize: vi.fn().mockResolvedValue(undefined),
        unmaximize: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
    };
    const unlisten = vi.fn();
    return { win, unlisten, getResizeHandler: () => resizeHandler };
};

describe('TitleBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        runtimeState.tauri = true;
        settingsState.developer = true;
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('renders nothing outside Tauri', () => {
        runtimeState.tauri = false;
        const { container } = render(<TitleBar />);
        expect(container.firstChild).toBeNull();
        expect(mockedGetCurrentWindow).not.toHaveBeenCalled();
    });

    it('initializes native controls and cleans up listeners', async () => {
        const { win, unlisten } = createWindow();
        mockedGetCurrentWindow.mockReturnValue(win as unknown as ReturnType<typeof getCurrentWindow>);
        const { unmount } = render(<TitleBar />);
        await screen.findByText('AMBIT');
        expect(screen.getByText('DEV')).toBeTruthy();
        expect(win.setIcon).toHaveBeenCalledWith('/branding/ambit-window-icon.png');

        const buttons = screen.getAllByRole('button');
        fireEvent.click(buttons[0]);
        fireEvent.click(buttons[1]);
        fireEvent.click(buttons[2]);
        await waitFor(() => expect(win.minimize).toHaveBeenCalledOnce());
        await waitFor(() => expect(win.maximize).toHaveBeenCalledOnce());
        expect(win.close).toHaveBeenCalledOnce();

        unmount();
        expect(unlisten).toHaveBeenCalledOnce();
    });

    it('unmaximizes, responds to resize, and toggles fullscreen with F11', async () => {
        const { win, getResizeHandler } = createWindow();
        win.isMaximized.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        win.isFullscreen.mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        mockedGetCurrentWindow.mockReturnValue(win as unknown as ReturnType<typeof getCurrentWindow>);
        const { container } = render(<TitleBar />);
        await screen.findByText('AMBIT');

        fireEvent.click(screen.getAllByRole('button')[1]);
        await waitFor(() => expect(win.unmaximize).toHaveBeenCalledOnce());

        await act(async () => getResizeHandler()?.());
        fireEvent.keyDown(window, { key: 'A' });
        fireEvent.keyDown(window, { key: 'F11' });
        await waitFor(() => expect(win.setFullscreen).toHaveBeenCalledWith(true));

        const trigger = container.querySelector('.fixed.top-0.h-4');
        expect(trigger).toBeTruthy();
        fireEvent.mouseEnter(trigger as Element);
        expect(container.querySelector('header')?.className).toContain('translate-y-0');
        fireEvent.mouseLeave(container.querySelector('header') as Element);
        expect(container.querySelector('header')?.className).toContain('-translate-y-full');
    });

    it('continues after icon failure and handles initialization failure', async () => {
        const first = createWindow();
        first.win.setIcon.mockRejectedValueOnce(new Error('unsupported'));
        mockedGetCurrentWindow.mockReturnValueOnce(first.win as unknown as ReturnType<typeof getCurrentWindow>);
        const view = render(<TitleBar />);
        await screen.findByText('AMBIT');
        expect(console.warn).toHaveBeenCalledWith('TitleBar: Failed to set window icon', expect.any(Error));
        view.unmount();

        mockedGetCurrentWindow.mockImplementationOnce(() => { throw new Error('not native'); });
        const failed = render(<TitleBar />);
        await waitFor(() => expect(console.warn).toHaveBeenCalledWith('TitleBar: Not in Tauri environment'));
        expect(failed.container.firstChild).toBeNull();
    });

    it('disposes listeners when initialization completes after unmount', async () => {
        const { win, unlisten } = createWindow();
        let resolveListen!: (unlisten: () => void) => void;
        win.listen.mockReturnValueOnce(new Promise(resolve => { resolveListen = resolve; }));
        mockedGetCurrentWindow.mockReturnValue(win as unknown as ReturnType<typeof getCurrentWindow>);
        const view = render(<TitleBar />);
        await screen.findByText('AMBIT');
        view.unmount();
        await act(async () => resolveListen(unlisten));
        expect(unlisten).toHaveBeenCalledOnce();
    });
});
