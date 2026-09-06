import assert from "node:assert/strict";
import test from "node:test";

import {
  createFaceSessionBoundary,
  createWakeLockController,
} from "../lifecycle.js";

function deferred() {
  let resolve;
  const promise = new Promise(settle => { resolve = settle; });
  return { promise, resolve };
}

function fakeWakeLock(releasePromise = Promise.resolve()) {
  let releaseListener = null;
  return {
    released: false,
    addEventListener(type, listener) {
      if (type === "release") releaseListener = listener;
    },
    async release() {
      this.released = true;
      await releasePromise;
      releaseListener?.();
    },
  };
}

test("face sessions increase monotonically and invalidation makes old sessions stale", () => {
  const sessions = createFaceSessionBoundary();

  const first = sessions.begin();
  assert.equal(first, 1);
  assert.equal(sessions.isCurrent(first), true);

  assert.equal(sessions.invalidate(), 2);
  assert.equal(sessions.active, false);
  assert.equal(sessions.isCurrent(first), false);

  const second = sessions.begin();
  assert.equal(second, 3);
  assert.equal(sessions.isCurrent(second), true);
  assert.equal(sessions.isCurrent(first), false);
});

test("wake-lock requests for one session are coalesced", async () => {
  const sessions = createFaceSessionBoundary();
  const session = sessions.begin();
  const requested = deferred();
  let requestCount = 0;
  const controller = createWakeLockController({
    requestLock: () => {
      requestCount += 1;
      return requested.promise;
    },
    isSessionCurrent: value => sessions.isCurrent(value),
  });

  const first = controller.acquire(session);
  const second = controller.acquire(session);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(requestCount, 1);

  const lock = fakeWakeLock();
  requested.resolve(lock);
  assert.equal(await first, lock);
  assert.equal(await second, lock);
});

test("a wake lock that arrives for a stale session is released immediately", async () => {
  const sessions = createFaceSessionBoundary();
  const session = sessions.begin();
  const requested = deferred();
  const controller = createWakeLockController({
    requestLock: () => requested.promise,
    isSessionCurrent: value => sessions.isCurrent(value),
  });

  const acquisition = controller.acquire(session);
  await Promise.resolve();
  sessions.invalidate();
  await controller.release();

  const lateLock = fakeWakeLock();
  requested.resolve(lateLock);
  assert.equal(await acquisition, null);
  assert.equal(lateLock.released, true);
});

test("release cancels a pending request even before its session is invalidated", async () => {
  const sessions = createFaceSessionBoundary();
  const session = sessions.begin();
  const requested = deferred();
  const controller = createWakeLockController({
    requestLock: () => requested.promise,
    isSessionCurrent: value => sessions.isCurrent(value),
  });

  const acquisition = controller.acquire(session);
  await Promise.resolve();
  await controller.release();

  const cancelledLock = fakeWakeLock();
  requested.resolve(cancelledLock);
  assert.equal(await acquisition, null);
  assert.equal(cancelledLock.released, true);
});

test("a releasing old lock cannot clear or overwrite a newer session's lock", async () => {
  const sessions = createFaceSessionBoundary();
  const oldRelease = deferred();
  const oldLock = fakeWakeLock(oldRelease.promise);
  const newLock = fakeWakeLock();
  const locks = [oldLock, newLock];
  let requestCount = 0;
  const controller = createWakeLockController({
    requestLock: () => locks[requestCount++],
    isSessionCurrent: value => sessions.isCurrent(value),
  });

  const oldSession = sessions.begin();
  assert.equal(await controller.acquire(oldSession), oldLock);

  sessions.invalidate();
  const releasingOldLock = controller.release();
  const newSession = sessions.begin();
  assert.equal(await controller.acquire(newSession), newLock);

  oldRelease.resolve();
  await releasingOldLock;
  assert.equal(await controller.acquire(newSession), newLock);
  assert.equal(requestCount, 2);
});

test("overlapping requests cannot let an old session replace a new lock", async () => {
  const sessions = createFaceSessionBoundary();
  const oldRequest = deferred();
  const newRequest = deferred();
  const requests = [oldRequest, newRequest];
  let requestCount = 0;
  const controller = createWakeLockController({
    requestLock: () => requests[requestCount++].promise,
    isSessionCurrent: value => sessions.isCurrent(value),
  });

  const oldSession = sessions.begin();
  const oldAcquisition = controller.acquire(oldSession);
  await Promise.resolve();
  sessions.invalidate();
  await controller.release();

  const newSession = sessions.begin();
  const newAcquisition = controller.acquire(newSession);
  await Promise.resolve();
  const newLock = fakeWakeLock();
  newRequest.resolve(newLock);
  assert.equal(await newAcquisition, newLock);

  const oldLock = fakeWakeLock();
  oldRequest.resolve(oldLock);
  assert.equal(await oldAcquisition, null);
  assert.equal(oldLock.released, true);
  assert.equal(await controller.acquire(newSession), newLock);
  assert.equal(requestCount, 2);
});
