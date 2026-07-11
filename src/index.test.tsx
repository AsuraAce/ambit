import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ render: vi.fn(), createRoot: vi.fn(), lazyLoads: [] as Promise<unknown>[] }));
mocks.createRoot.mockReturnValue({ render: mocks.render });

vi.mock('react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react')>();
    return {
        ...actual,
        lazy: (loader: () => Promise<unknown>) => {
            mocks.lazyLoads.push(loader());
            return () => null;
        }
    };
});
vi.mock('react-dom/client', () => ({ default: { createRoot: mocks.createRoot }, createRoot: mocks.createRoot }));
vi.mock('./App', () => ({ default: () => null }));
vi.mock('./contexts/ToastContext', () => ({ ToastProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./contexts/LibraryContext', () => ({ LibraryProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./components/StartupMaintenanceGate', () => ({ StartupMaintenanceGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./components/ui/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@tanstack/react-query-devtools', () => ({ ReactQueryDevtools: () => null }));

describe('application bootstrap', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.lazyLoads.length = 0;
        document.body.innerHTML = '';
    });

    it('mounts the application provider tree into the root element', async () => {
        const root = document.createElement('div');
        root.id = 'root';
        document.body.append(root);

        await import('./index');
        await Promise.all(mocks.lazyLoads);

        expect(mocks.createRoot).toHaveBeenCalledWith(root);
        expect(mocks.render).toHaveBeenCalledTimes(1);
        expect(mocks.render.mock.calls[0][0]).toBeTruthy();
    });

    it('fails fast when the host page does not provide a root element', async () => {
        await expect(import('./index')).rejects.toThrow('Could not find root element to mount to');
        expect(mocks.createRoot).not.toHaveBeenCalled();
    });
});
