import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const bootstrapSource = readFileSync(join(process.cwd(), 'public', 'startup-bootstrap.js'), 'utf8');

let latestBootstrap: Window['__AMBIT_STARTUP_BOOTSTRAP__'];

const installBootstrap = () => {
    document.body.innerHTML = '<div id="static-loading"><p class="static-loading__subtitle">Initializing library...</p></div>';
    window.eval(bootstrapSource);
    latestBootstrap = window.__AMBIT_STARTUP_BOOTSTRAP__!;
    return latestBootstrap;
};

afterEach(() => {
    latestBootstrap?.markReady();
    latestBootstrap = undefined;
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('startup bootstrap', () => {
    it('keeps the brand and status visible without animation or logo loading, including reduced motion', () => {
        const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
        for (const selector of ['static-loading__brand', 'static-loading__status']) {
            const rule = html.match(new RegExp(`\\.${selector} \\{([^}]+)\\}`))?.[1];
            expect(rule).toContain('opacity: 1');
            expect(rule).not.toContain('animation:');
        }
        expect(html).toContain('@media (prefers-reduced-motion: reduce)');
        expect(html).toContain('<svg class="static-loading__loader-ring"');
    });
    it('does not classify logo or stylesheet resource failures as startup failures', () => {
        const bootstrap = installBootstrap();
        const logo = document.createElement('img');
        const stylesheet = document.createElement('link');
        document.body.append(logo);
        document.head.append(stylesheet);
        logo.dispatchEvent(new Event('error'));
        stylesheet.dispatchEvent(new Event('error'));

        expect(bootstrap.takeEvents()).toEqual([]);
    });

    it('stops capturing failures after startup readiness', () => {
        const bootstrap = installBootstrap();
        bootstrap.markReady();
        window.dispatchEvent(new ErrorEvent('error'));

        expect(bootstrap.takeEvents()).toEqual([]);
    });

    it('shows a fixed fallback when the app script fails before React can mount', () => {
        const bootstrap = installBootstrap();
        const script = document.createElement('script');
        document.body.append(script);
        script.dispatchEvent(new Event('error'));

        expect(bootstrap.takeEvents()).toEqual([expect.objectContaining({
            phase: 'startup-failure', failureKind: 'script-load',
        })]);
        expect(document.querySelector('[data-startup-failure="true"]')?.textContent)
            .toContain('Ambit couldn’t start');
        bootstrap.setFailureLaunchId('launch-123');
        expect(document.querySelector('[data-startup-launch-id="true"]')?.textContent)
            .toBe('Launch ID: launch-123');
        const loader = document.getElementById('static-loading')!;
        expect(loader.style.position).toBe('fixed');
        expect(loader.style.zIndex).toBe('2147483647');
        expect(loader.style.display).toBe('flex');
    });

    it('recreates the fatal overlay with a known launch ID after the static loader was removed', () => {
        const bootstrap = installBootstrap();
        bootstrap.setFailureLaunchId('launch-after-ready');
        document.getElementById('static-loading')?.remove();

        bootstrap.showFailure();

        expect(document.querySelector('[data-startup-failure="true"]')?.textContent)
            .toContain('Ambit couldn’t start');
        expect(document.querySelector('[data-startup-launch-id="true"]')?.textContent)
            .toBe('Launch ID: launch-after-ready');
        const loader = document.getElementById('static-loading')!;
        expect(loader.style.position).toBe('fixed');
        expect(loader.style.inset).toBe('0px');
        expect(loader.style.zIndex).toBe('2147483647');
        expect(loader.style.display).toBe('flex');
    });

    it('deduplicates repeated early failure classes so they cannot crowd out later terminal events', () => {
        const bootstrap = installBootstrap();
        const script = document.createElement('script');
        document.body.append(script);
        script.dispatchEvent(new Event('error'));
        script.dispatchEvent(new Event('error'));
        window.dispatchEvent(new Event('unhandledrejection'));

        expect(bootstrap.takeEvents().map(event => event.failureKind)).toEqual([
            'script-load', 'unhandled-rejection',
        ]);
    });

    it('keeps the static fallback explicit when its transport cannot run', () => {
        const bootstrap = installBootstrap();
        bootstrap.markTransportUnavailable();

        expect(document.querySelector('.static-loading__subtitle')?.textContent)
            .toBe('Startup diagnostics unavailable. Ambit will continue starting.');
    });

    it('shows a fatal fallback if the sole module entry cannot load the app', () => {
        const bootstrap = installBootstrap();
        const script = document.createElement('script');
        script.id = 'startup-diagnostic-entry';
        document.body.append(script);
        script.dispatchEvent(new Event('error'));

        expect(document.querySelector('[data-startup-failure="true"]')?.textContent).toContain('Ambit couldn’t start');
        expect(document.getElementById('static-loading')?.dataset.ambitFatal).toBe('true');
        expect(bootstrap.takeEvents()).toEqual([expect.objectContaining({
            phase: 'startup-failure', failureKind: 'script-load',
        })]);
    });

    it('shows a nonfatal status after fifteen seconds without React mounting', () => {
        vi.useFakeTimers();
        installBootstrap();
        vi.advanceTimersByTime(15_000);

        expect(document.querySelector('.static-loading__subtitle')?.textContent)
            .toBe('Startup is taking longer than expected');
        expect(document.getElementById('static-loading')?.dataset.ambitFatal).toBeUndefined();
    });

    it('warns thirty seconds after React mounts only while the existing loader is still pending', () => {
        vi.useFakeTimers();
        const bootstrap = installBootstrap();
        bootstrap.markReactMounted();
        vi.advanceTimersByTime(30_000);

        expect(document.querySelector('.static-loading__subtitle')?.textContent)
            .toBe('Startup is taking longer than expected');

        document.getElementById('static-loading')?.remove();
        bootstrap.markReady();
        vi.advanceTimersByTime(30_000);
        expect(document.getElementById('static-loading')).toBeNull();
    });

    it('does not recreate a removed loader for the post-mount warning', () => {
        vi.useFakeTimers();
        const bootstrap = installBootstrap();
        bootstrap.markReactMounted();
        document.getElementById('static-loading')?.remove();

        vi.advanceTimersByTime(30_000);

        expect(document.getElementById('static-loading')).toBeNull();
        expect(bootstrap.takeEvents()).toEqual([]);
    });

    it('stops both startup warnings when the bootstrap becomes fatal', () => {
        vi.useFakeTimers();
        const bootstrap = installBootstrap();
        bootstrap.markReactMounted();
        const script = document.createElement('script');
        document.body.append(script);
        script.dispatchEvent(new Event('error'));
        bootstrap.takeEvents();

        vi.advanceTimersByTime(30_000);

        expect(bootstrap.takeEvents()).toEqual([]);
    });

    it('ignores warning callbacks captured before a fatal fallback', () => {
        const callbacks: Array<() => void> = [];
        const inactiveTimer = setTimeout(() => undefined, 0);
        clearTimeout(inactiveTimer);
        vi.spyOn(window, 'setTimeout').mockImplementation((handler) => {
            if (typeof handler === 'function') callbacks.push(handler);
            return inactiveTimer;
        });
        const bootstrap = installBootstrap();
        bootstrap.markReactMounted();
        const [preMountWarning, postMountWarning] = callbacks;
        const script = document.createElement('script');
        document.body.append(script);
        script.dispatchEvent(new Event('error'));
        bootstrap.takeEvents();

        preMountWarning?.();
        postMountWarning?.();

        expect(bootstrap.takeEvents()).toEqual([]);
        expect(document.querySelector('[data-startup-failure="true"]')?.textContent)
            .toContain('Ambit couldn’t start');
    });
});
