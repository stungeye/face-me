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
