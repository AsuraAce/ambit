
import { vi } from 'vitest';

// Mock Tauri Core
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

// Mock Tauri App
vi.mock('@tauri-apps/api/app', () => ({
    getVersion: vi.fn().mockResolvedValue('0.3.0'),
}));

// Mock Tauri Event
vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn().mockResolvedValue(() => { }),
    emit: vi.fn(),
}));

// Mock Tauri SQL Plugin
vi.mock('@tauri-apps/plugin-sql', () => ({
    default: {
        load: vi.fn().mockResolvedValue({
            execute: vi.fn().mockResolvedValue({}),
            select: vi.fn().mockResolvedValue([]),
        }),
    },
}));

// Mock Tauri Dialog Plugin
vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(),
    open: vi.fn(),
    message: vi.fn(),
    ask: vi.fn(),
    confirm: vi.fn(),
}));

// Mock Tauri Shell Plugin
vi.mock('@tauri-apps/plugin-shell', () => ({
    Command: class {
        static create = vi.fn();
        execute = vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' });
        spawn = vi.fn().mockResolvedValue({});
    },
}));

// Mock Tauri Process Plugin
vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn().mockResolvedValue(undefined),
}));

// Mock Tauri Updater Plugin
vi.mock('@tauri-apps/plugin-updater', () => ({
    check: vi.fn().mockResolvedValue(null),
}));

// Mock Tauri FS Plugin
vi.mock('@tauri-apps/plugin-fs', () => ({
    readTextFile: vi.fn(),
    writeTextFile: vi.fn(),
    remove: vi.fn(),
    mkdir: vi.fn(),
    readDir: vi.fn(),
    exists: vi.fn(),
    BaseDirectory: {
        AppData: 0,
        Document: 1,
        Download: 2,
        Home: 3,
        Video: 4,
        Picture: 5,
        Public: 6,
        Temp: 7,
        Template: 8,
        Config: 9,
        Cache: 10,
        LocalData: 11,
        Resource: 12,
        Runtime: 13,
    }
}));

// Mock Worker
class MockWorker {
    onmessage: ((ev: MessageEvent) => any) | null = null;
    addEventListener(ev: string, handler: any) { }
    removeEventListener(ev: string, handler: any) { }
    postMessage(data: any) { }
    terminate() { }
}
vi.spyOn(MockWorker.prototype, 'addEventListener');
vi.spyOn(MockWorker.prototype, 'postMessage');
vi.spyOn(MockWorker.prototype, 'terminate');
vi.stubGlobal('Worker', MockWorker);

// Mock Image
class MockImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src: string = '';
    crossOrigin: string = '';
    width: number = 0;
    height: number = 0;
    constructor() {
        setTimeout(() => {
            if (this.src.includes('broken')) {
                this.onerror?.();
            } else {
                this.onload?.();
            }
        }, 10);
    }
}
vi.stubGlobal('Image', MockImage);

// Mock Canvas
if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({
            data: new Uint8ClampedArray(100 * 100 * 4),
        })),
    })) as any;
}
