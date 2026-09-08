(function () {
  'use strict';

  var maxEvents = 32;
  var terminalPhases = { 'startup-failure': true, 'renderer-stall': true };
  var events = [];
  var terminalEvents = {};
  var launchId;
  var stallTimer;
  var postMountTimer;
  var startupActive = true;
  var fatalShown = false;

  function elapsedMs() {
    var now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return Math.max(0, Math.round(now));
  }

  function staticLoader() {
    return document.getElementById('static-loading');
  }

  function updateStatus(message) {
    var status = document.querySelector('.static-loading__subtitle');
    if (status) status.textContent = message;
  }

  function stopTimers() {
    if (stallTimer) window.clearTimeout(stallTimer);
    if (postMountTimer) window.clearTimeout(postMountTimer);
    stallTimer = undefined;
    postMountTimer = undefined;
  }

  function showFailure() {
    stopTimers();
    fatalShown = true;
    var loader = staticLoader();
    if (!loader) {
      loader = document.createElement('div');
      loader.id = 'static-loading';
      document.body.appendChild(loader);
    }
    if (loader.dataset.ambitFatal === 'true') return;
    loader.dataset.ambitFatal = 'true';
    loader.style.position = 'fixed';
    loader.style.inset = '0';
    loader.style.zIndex = '2147483647';
    loader.style.display = 'flex';
    loader.style.alignItems = 'center';
    loader.style.justifyContent = 'center';
    loader.style.background = '#09090b';
    loader.style.opacity = '1';
    loader.style.pointerEvents = 'auto';
    loader.innerHTML = '<main data-startup-failure="true" role="alert" style="max-width:32rem;padding:2rem;text-align:center;color:#f4f4f5;font-family:Inter,ui-sans-serif,system-ui,sans-serif"><h1 style="margin:0 0 .75rem;font-size:1.25rem">Ambit couldn’t start</h1><p style="margin:0;color:#d4d4d8;font-size:.9rem">Restart Ambit. If the problem continues, share this launch ID with support.</p><p data-startup-launch-id="true" style="margin:1rem 0 0;color:#a1a1aa;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.75rem">Launch ID: ' + (launchId || 'unavailable') + '</p></main>';
  }

  function setFailureLaunchId(value) {
    launchId = value;
    var launch = document.querySelector('[data-startup-launch-id="true"]');
    if (launch) launch.textContent = 'Launch ID: ' + launchId;
  }

  function removeOldestNonTerminal() {
    for (var index = 0; index < events.length; index += 1) {
      if (!terminalPhases[events[index].phase]) {
        events.splice(index, 1);
        return true;
      }
    }
    return false;
  }

  function record(phase, status, failureKind, durationMs) {
    var event = {
      phase: phase,
      status: status,
      elapsedMs: elapsedMs(),
      durationMs: durationMs == null ? null : durationMs,
      cacheAction: null
    };
    if (failureKind) event.failureKind = failureKind;
    if (terminalPhases[phase]) {
      var terminalKey = phase + ':' + status + ':' + (failureKind || '');
      if (terminalEvents[terminalKey]) return;
      terminalEvents[terminalKey] = true;
    }
    if (events.length < maxEvents) {
      events.push(event);
    } else if (terminalPhases[phase] && removeOldestNonTerminal()) {
      events.push(event);
    } else {
      return;
    }
    window.dispatchEvent(new CustomEvent('ambit-startup-diagnostic', { detail: event }));
  }

  window.__AMBIT_STARTUP_BOOTSTRAP__ = {
    takeEvents: function () { return events.splice(0); },
    markReactMounted: function () {
      if (stallTimer) window.clearTimeout(stallTimer);
      stallTimer = undefined;
      if (!startupActive || !staticLoader() || staticLoader()?.dataset.ambitFatal === 'true' || postMountTimer) return;
      postMountTimer = window.setTimeout(function () {
        postMountTimer = undefined;
        if (!startupActive || fatalShown || !staticLoader()) return;
        updateStatus('Startup is taking longer than expected');
        record('renderer-stall', 'completed', null, 30000);
      }, 30000);
    },
    markReady: function () {
      startupActive = false;
      stopTimers();
    },
    showFailure: showFailure,
    markTransportUnavailable: function () {
      updateStatus('Startup diagnostics unavailable. Ambit will continue starting.');
    },
    setFailureLaunchId: setFailureLaunchId
  };

  window.addEventListener('error', function (event) {
    var target = event.target;
    if (!startupActive) return;
    if (target && target.tagName === 'SCRIPT') {
      showFailure();
      record('startup-failure', 'failed', 'script-load');
    } else if (target === window) {
      showFailure();
      record('startup-failure', 'failed', 'uncaught-error');
    }
  }, true);
  window.addEventListener('unhandledrejection', function () {
    if (!startupActive) return;
    showFailure();
    record('startup-failure', 'failed', 'unhandled-rejection');
  });
  stallTimer = window.setTimeout(function () {
    if (!startupActive || fatalShown || !staticLoader()) return;
    updateStatus('Startup is taking longer than expected');
    record('renderer-stall', 'completed', null, 15000);
  }, 15000);
}());
