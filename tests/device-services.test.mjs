import { test } from "node:test";
import assert from "node:assert/strict";
import { createLocationService } from "../device-services.js";

function harness(permissions) {
  const requests = [], cleared = [], readings = [], statuses = [], timers = new Map();
  const service = createLocationService({
    geolocation: {
      watchPosition(ok, error, options) { requests.push({ ok, error, options }); return requests.length; },
      clearWatch(id) { cleared.push(id); },
    }, permissions, now: () => 100000,
    setTimer(fn) { const id = timers.size + 1; timers.set(id, fn); return id; },
    clearTimer(id) { timers.delete(id); },
    onReading: reading => readings.push(reading), onStatus: status => statuses.push(status),
  });
  const position = (accuracy = 10, timestamp = 100000) => ({ coords: { latitude: 49, longitude: -97, accuracy }, timestamp });
  return { service, requests, cleared, readings, statuses, timers, position };
}

test("setup refines a usable fix within a bounded single watch", () => {
  const h = harness(); h.service.acquire();
  assert.equal(h.requests[0].options.enableHighAccuracy, true);
  h.requests[0].ok(h.position(200));
  assert.equal(h.service.snapshot.state, "refining");
  h.requests[0].ok(h.position(300));
  assert.equal(h.readings.length, 1);
  h.requests[0].ok(h.position(15));
  assert.equal(h.service.snapshot.state, "ready");
  assert.deepEqual(h.cleared, [1]);
  assert.equal(h.timers.size, 0);
});

test("deadline reports timeout or keeps the best imprecise fix", () => {
  for (const hasFix of [false, true]) {
    const h = harness(); h.service.acquire();
    if (hasFix) h.requests[0].ok(h.position(500));
    [...h.timers.values()][0]();
    assert.equal(h.service.snapshot.state, hasFix ? "ready" : "error");
    assert.deepEqual(h.cleared, [1]);
  }
});

test("retry and stop invalidate queued callbacks and replace the sole watch", () => {
  const h = harness(); h.service.acquire(); h.service.watch();
  h.requests[0].ok(h.position()); h.requests[0].error({ code: 1 });
  assert.equal(h.readings.length, 0);
  h.requests[1].ok(h.position()); h.service.stop();
  h.requests[1].ok(h.position());
  assert.equal(h.readings.length, 1);
  assert.deepEqual(h.cleared, [1, 2]);
});

test("permission query is advisory even when denied, rejected or pending", async () => {
  for (const query of [() => Promise.resolve({ state: "denied" }), () => Promise.reject(new Error()), () => new Promise(() => {})]) {
    const h = harness({ query }); h.service.acquire();
    assert.equal(h.requests.length, 1);
    await Promise.resolve();
    h.requests[0].ok(h.position());
    assert.equal(h.readings.length, 1);
  }
});

test("watch errors surface and transient errors recover; denied stops", () => {
  const h = harness(); h.service.watch();
  h.requests[0].error({ code: 2 });
  assert.equal(h.service.snapshot.error.code, 2);
  h.requests[0].ok(h.position());
  assert.equal(h.service.snapshot.error, null);
  h.requests[0].error({ code: 1 });
  assert.deepEqual(h.cleared, [1]);
});

test("stale, malformed, future and out-of-order fixes cannot replace location", () => {
  const h = harness(); h.service.watch();
  h.requests[0].ok(h.position(10, 1000));
  h.requests[0].ok(h.position(NaN));
  h.requests[0].ok(h.position(10, 200000));
  assert.equal(h.readings.length, 0);
  h.requests[0].ok(h.position());
  h.requests[0].ok(h.position(5, 99999));
  assert.equal(h.readings.length, 1);
});

test("stationary watch renews one uncached acquisition and stop cancels renewal", () => {
  const h=harness();h.service.watch();h.requests[0].ok(h.position());
  [...h.timers.values()][0]();
  assert.deepEqual(h.cleared,[1]); assert.equal(h.requests.length,2);
  assert.equal(h.requests[1].options.maximumAge,0);
  h.requests[0].ok(h.position()); assert.equal(h.readings.length,1);
  h.requests[1].ok(h.position()); assert.equal(h.readings.length,2);
  h.service.stop(); assert.equal(h.timers.size,0);
});
