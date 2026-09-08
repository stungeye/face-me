// Browser location details stay here. Consumers receive geodetic readings and
// status, never native Position/PositionError objects. All clocks are injectable.
export function createLocationService({
  geolocation = globalThis.navigator?.geolocation,
  permissions = globalThis.navigator?.permissions,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onReading = () => {},
  onStatus = () => {},
} = {}) {
  let generation = 0;
  let watchId = null;
  let timer = null;
  let snapshot = { state: "idle", permission: "unknown", error: null, reading: null, transitions: [] };
  function publish(update) {
    const transitions = update.state && update.state !== snapshot.state
      ? [...snapshot.transitions, { from: snapshot.state, to: update.state, timestamp: now() }].slice(-12)
      : snapshot.transitions;
    snapshot = { ...snapshot, ...update, transitions };
    onStatus({ ...snapshot });
  }
  function cancel() {
    generation += 1;
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (watchId !== null) geolocation?.clearWatch(watchId);
    watchId = null;
  }
  function start(continuous) {
    cancel();
    const token = generation;
    let best = null;
    publish({ state: "acquiring", error: null });
    // Unsupported, rejected, or indefinitely pending permission queries must not
    // prevent the actual geolocation request (notably on Safari).
    try {
      Promise.resolve(permissions?.query({ name: "geolocation" })).then(result => {
        if (token === generation && result?.state) publish({ permission: result.state });
      }).catch(() => {});
    } catch {}
    function fail(error) {
      if (token !== generation) return;
      const code = Number.isFinite(error?.code) ? error.code : 2;
      if (code === 0 || code === 1) cancel();
      publish({ state: best ? "degraded" : "error", error: { code, message: String(error?.message || "Location unavailable") } });
    }
    if (!geolocation?.watchPosition) {
      fail({ code: 0, message: "This browser does not provide geolocation." });
      return;
    }
    if (!continuous) {
      timer = setTimer(() => {
        if (token !== generation) return;
        cancel();
        publish(best ? { state: "ready", error: null } : { state: "error", error: { code: 3, message: "Location timed out" } });
      }, 20000);
    }
    // Some stationary-device watches emit no further updates. Renew the single
    // watch at most once per 30 seconds, requesting an uncached fix on renewal.
    if (continuous) timer = setTimer(() => {
      if (token === generation) start(true);
    }, 30000);
    try {
      const id = geolocation.watchPosition(position => {
        if (token !== generation) return;
        const { latitude: lat, longitude: lon, accuracy } = position.coords || {};
        const timestamp = position.timestamp;
        if (![lat, lon, accuracy, timestamp].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || accuracy < 0 || now() - timestamp > 30000 || timestamp > now() + 1000) return;
        if (best && (timestamp < best.timestamp || (!continuous && accuracy > best.accuracy))) return;
        best = { lat, lon, accuracy, timestamp };
        // Publish before callbacks, which may stop this service or exit a session.
        publish({ state: !continuous && accuracy > 30 ? "refining" : "ready", reading: best, error: null });
        onReading({ ...best });
        if (token === generation && !continuous && accuracy <= 30) cancel();
      }, fail, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
      // Also handle synchronous callbacks in injected implementations.
      if (token === generation) watchId = id;
      else geolocation.clearWatch(id);
    } catch (error) { fail(error); }
  }
  return Object.freeze({
    acquire: () => start(false),
    watch: () => start(true),
    stop() { cancel(); publish({ state: "idle" }); },
    get snapshot() { return { ...snapshot, reading: snapshot.reading && { ...snapshot.reading } }; },
  });
}
