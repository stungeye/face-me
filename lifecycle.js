export function createFaceSessionBoundary() {
  let generation = 0;
  let active = false;

  return Object.freeze({
    begin() {
      active = true;
      generation += 1;
      return generation;
    },
    invalidate() {
      active = false;
      generation += 1;
      return generation;
    },
    isCurrent(session) {
      return active && session === generation;
    },
    get active() {
      return active;
    },
    get generation() {
      return generation;
    },
  });
}

export function createWakeLockController({ requestLock, isSessionCurrent }) {
  let lock = null;
  let lockSession = null;
  let pending = null;

  async function releaseLock(lockToRelease) {
    try {
      await lockToRelease.release();
    } catch {}
  }

  function acquire(session) {
    if (!isSessionCurrent(session) || typeof requestLock !== "function") {
      return Promise.resolve(null);
    }

    if (lock?.released) {
      lock = null;
      lockSession = null;
    }
    if (lock && lockSession === session) return Promise.resolve(lock);
    if (lock) {
      const staleLock = lock;
      lock = null;
      lockSession = null;
      void releaseLock(staleLock);
    }
    if (pending?.session === session) return pending.promise;

    const request = { session, promise: null, cancelled: false };
    request.promise = Promise.resolve()
      .then(() => requestLock())
      .then(async acquiredLock => {
        if (!acquiredLock) return null;
        if (request.cancelled || !isSessionCurrent(session)) {
          await releaseLock(acquiredLock);
          return null;
        }
        if (lock) {
          await releaseLock(acquiredLock);
          return lock;
        }

        lock = acquiredLock;
        lockSession = session;
        acquiredLock.addEventListener?.("release", () => {
          if (lock === acquiredLock) {
            lock = null;
            lockSession = null;
          }
        }, { once: true });
        return acquiredLock;
      })
      .catch(() => null)
      .finally(() => {
        if (pending === request) pending = null;
      });
    pending = request;
    return request.promise;
  }

  function release() {
    if (pending) pending.cancelled = true;
    pending = null;
    const lockToRelease = lock;
    if (lock === lockToRelease) {
      lock = null;
      lockSession = null;
    }
    return lockToRelease ? releaseLock(lockToRelease) : Promise.resolve();
  }

  return Object.freeze({ acquire, release });
}
export function createDeviceSession({ document, window, onPause, onResume, onSetupPause = () => false, onSetupResume = () => {} }) {
  const boundary = createFaceSessionBoundary();
  let engaged = false;
  let paused = false;
  let setupPending = false;
  function pause() {
    if (!engaged) { setupPending = onSetupPause() || setupPending; return; }
    if (paused) return;
    paused = true;
    boundary.invalidate();
    onPause();
  }
  function resume() {
    if (document.visibilityState !== "visible") return;
    if (!engaged) { if (setupPending) { setupPending = false; onSetupResume(); } return; }
    if (!paused) return;
    paused = false;
    onResume(boundary.begin());
  }
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" ? resume() : pause());
  window.addEventListener("pagehide", pause);
  window.addEventListener("pageshow", resume);
  return Object.freeze({
    begin() { engaged = true; paused = false; return boundary.begin(); },
    invalidate() { engaged = false; paused = false; return boundary.invalidate(); },
    isCurrent: token => boundary.isCurrent(token),
    get active() { return engaged; },
    get generation() { return boundary.generation; },
  });
}
export function createBrowserPresentation({ document, screen, isCurrent, isActive }) {
  async function fullscreen(session) {
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: "hide" }); } catch {}
    if (!isCurrent(session) && !isActive()) await exit();
  }
  async function portrait(session) {
    try { await screen.orientation?.lock?.("portrait"); } catch {}
    if (!isCurrent(session) && !isActive()) { try { screen.orientation?.unlock?.(); } catch {} }
  }
  async function exit() {
    try { screen.orientation?.unlock?.(); } catch {}
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch {}
  }
  return { fullscreen, portrait, exit };
}
