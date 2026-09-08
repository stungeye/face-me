import { deviceOrientationMatrix, earthToLocalFromRowMajorMatrix, earthToLocalFromSensorMatrix } from "./core.js?v=1.10.0";

const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const transposeTransform = matrix => axes.map(axis => earthToLocalFromRowMajorMatrix(matrix, axis));
export function transformEarthToPhone(transform, vector) {
  return [0, 1, 2].map(row => transform[0][row] * vector[0] + transform[1][row] * vector[1] + transform[2][row] * vector[2]);
}

export function normalizeOrientationEvent(event, source, timestamp) {
  if (![event.beta, event.gamma].every(Number.isFinite)) return null;
  let alpha = event.alpha;
  let northReference = "unknown";
  let accuracy = null;
  if ("webkitCompassHeading" in event) {
    const heading = event.webkitCompassHeading;
    accuracy = event.webkitCompassAccuracy;
    if (!Number.isFinite(heading) || heading < 0 || heading >= 360 || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 45) return null;
    // WebKit forwards CLHeading (portrait top-edge azimuth) and W3C ZXY tilt.
    // Solve yaw from the horizontal projection of the tilted top edge. Beyond
    // vertical the projection reverses; at vertical its azimuth is undefined.
    const tilt = deviceOrientationMatrix(0, event.beta, event.gamma);
    if (Math.hypot(tilt[1], tilt[4]) < 0.02) return null;
    alpha = Math.atan2(tilt[1], tilt[4]) * 180 / Math.PI - heading;
    northReference = "magnetic";
    source = "webkitCompassHeading";
  } else if (!Number.isFinite(alpha) || !(event.absolute === true || source === "deviceorientationabsolute")) {
    return null;
  }
  return { transform: transposeTransform(deviceOrientationMatrix(alpha, event.beta, event.gamma)), source,
    timestamp, northReference, quality: accuracy === null ? "unreported" : "compass", accuracy,
    angles: [alpha, event.beta, event.gamma] };
}

export function normalizeGenericOrientation(matrix, screenAngle, timestamp) {
  if (!Number.isFinite(screenAngle) || matrix.length !== 16 || !Array.from(matrix).every(Number.isFinite)) return null;
  const angle = screenAngle * Math.PI / 180;
  const c = Math.cos(angle), s = Math.sin(angle);
  const transform = axes.map(axis => {
    const [x, y, z] = earthToLocalFromSensorMatrix(matrix, axis);
    // Undo the screen reference rotation to keep +Y at the physical portrait
    // top edge. At zero degrees this is the physically tested Pixel transform.
    return [c * x - s * y, s * x + c * y, z];
  });
  if (transform.some(axis => Math.abs(Math.hypot(...axis) - 1) > 0.05)) return null;
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const [a,b,d] = transform;
  const determinant = a[0]*(b[1]*d[2]-b[2]*d[1])-b[0]*(a[1]*d[2]-a[2]*d[1])+d[0]*(a[1]*b[2]-a[2]*b[1]);
  if (Math.abs(dot(a,b)) > 0.05 || Math.abs(dot(a,d)) > 0.05 || Math.abs(dot(b,d)) > 0.05 || determinant < 0.95) return null;
  return { transform, source: "AbsoluteOrientationSensor(screen)", timestamp,
    northReference: "unknown", quality: "unreported", accuracy: null, angles: [null, null, null] };
}

export function createOrientationService({ environment = globalThis, now = () => performance.now(),
  onReading = () => {}, onStatus = () => {}, setTimer = setTimeout, clearTimer = clearTimeout,
  staleMs = 2000, startupMs = 700 } = {}) {
  let active = false, generation = 0, sensor = null, timer = null, listeners = [];
  let snapshot = { state: "idle", source: "none", reading: null, error: "", transitions: [] };
  const status = (state, source, error = "") => {
    const transitions = snapshot.source === source ? snapshot.transitions : [...snapshot.transitions, { from: snapshot.source, to: source, timestamp: now() }].slice(-12);
    snapshot = { ...snapshot, state, source, error, transitions };
    onStatus(snapshot);
  };
  const clearOwned = () => {
    clearTimer(timer); timer = null;
    if (sensor) { const old = sensor; sensor = null; try { old.stop(); } catch {} }
    for (const [name, handler] of listeners) environment.removeEventListener(name, handler, true);
    listeners = [];
  };
  const accept = reading => {
    snapshot = { ...snapshot, reading };
    status("ready", reading.source);
    onReading(reading);
  };
  function events(token) {
    clearOwned();
    snapshot = { ...snapshot, reading: null };
    status("acquiring", "orientation events", snapshot.error);
    let owner = null, compassCalibration = null;
    const arm = () => {
      clearTimer(timer);
      timer = setTimer(() => {
        if (!active || token !== generation) return;
        owner = null;
        snapshot = { ...snapshot, reading: null };
        status("stale", "orientation events", "Direction expired. Move the phone slowly to reacquire north.");
      }, staleMs);
    };
    for (const name of ["deviceorientationabsolute", "deviceorientation"]) {
      const handler = event => {
        if (!active || token !== generation) return;
        if (owner === "deviceorientationabsolute" && name !== owner) return;
        let reading = normalizeOrientationEvent(event, name, now());
        if (reading?.source === "webkitCompassHeading" && Number.isFinite(event.alpha)) {
          compassCalibration = { offset: reading.angles[0] - event.alpha, timestamp: now() };
        } else if (!reading && "webkitCompassHeading" in event && compassCalibration
          && now() - compassCalibration.timestamp < staleMs
          && [event.alpha, event.beta, event.gamma].every(Number.isFinite)
          && Math.abs(Math.cos(event.beta * Math.PI / 180)) < 0.02
          && Number.isFinite(event.webkitCompassAccuracy) && event.webkitCompassAccuracy >= 0 && event.webkitCompassAccuracy <= 45) {
          const alpha = event.alpha + compassCalibration.offset;
          reading = { transform: transposeTransform(deviceOrientationMatrix(alpha, event.beta, event.gamma)),
            source: "webkitCompassHeading", timestamp: now(), northReference: "magnetic", quality: "propagated",
            accuracy: event.webkitCompassAccuracy, angles: [alpha, event.beta, event.gamma] };
        }
        if (!reading) {
          if (owner === name || !owner) {
            snapshot = { ...snapshot, reading: null };
            status("unavailable", name, "webkitCompassHeading" in event && Math.abs(Math.cos(event.beta * Math.PI / 180)) < 0.02
              ? "Briefly level the phone to reacquire north, then tilt again."
              : "Reliable north is unavailable. Enable motion access and calibrate the compass away from magnets.");
          }
          return;
        }
        owner = name;
        accept(reading); arm();
      };
      listeners.push([name, handler]);
      environment.addEventListener(name, handler, true);
    }
    arm();
  }
  function start() {
    stop(); active = true; const token = generation;
    snapshot = { ...snapshot, reading: null };
    status("acquiring", "starting");
    if (typeof environment.AbsoluteOrientationSensor !== "function") { events(token); return; }
    try {
      const current = new environment.AbsoluteOrientationSensor({ frequency: 60, referenceFrame: "screen" });
      sensor = current;
      const arm = delay => {
        clearTimer(timer);
        timer = setTimer(() => { if (active && token === generation && sensor === current) events(token); }, delay);
      };
      current.addEventListener("reading", () => {
        if (!active || token !== generation || sensor !== current) return;
        try {
          const matrix = new Float32Array(16); current.populateMatrix(matrix);
          const angle = environment.screen?.orientation?.angle ?? environment.orientation ?? 0;
          const reading = normalizeGenericOrientation(matrix, angle, now());
          if (reading) { accept(reading); arm(staleMs); }
        } catch (error) { status("unavailable", "generic sensor", error.message); events(token); }
      });
      current.addEventListener("error", event => {
        if (!active || token !== generation || sensor !== current) return;
        status("unavailable", "generic sensor", event.error?.message || "Orientation sensor unavailable.");
        events(token);
      });
      arm(startupMs); current.start();
    } catch (error) { status("unavailable", "generic sensor", error.message); events(token); }
  }
  function stop() {
    active = false; generation++; clearOwned();
    snapshot = { ...snapshot, reading: null }; status("idle", "none");
  }
  // Invoke directly from the click stack, before fullscreen can consume activation.
  function requestPermission() {
    const token = generation;
    try {
      const type = environment.DeviceOrientationEvent;
      const result = typeof type?.requestPermission === "function" ? type.requestPermission() : "granted";
      return Promise.resolve(result).then(value => {
        if (value !== "granted") throw new Error("Motion permission denied. Allow Motion & Orientation in browser settings, then tap FACE ME again.");
      }).catch(error => { if (token === generation) status("denied", "permission denied", error.message); throw error; });
    } catch (error) { status("denied", "permission denied", error.message); return Promise.reject(error); }
  }
  return { start, stop, requestPermission, get snapshot() { return snapshot; } };
}
