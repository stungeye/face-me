import {
  ALIGNMENT_AXIS,
  angleDegBetween,
  bearingDeg,
  clamp,
  cross,
  deviceOrientationMatrix,
  earthToLocalFromRowMajorMatrix,
  earthToLocalFromSensorMatrix,
  fmt,
  formatCoordinates,
  formatDistance,
  formatTilt,
  inclinationDeg,
  normalize,
  parseCoordinates,
  parseCoordinatesFromSearch,
  rotationMatrixFromY,
  smoothDirection,
  targetDetails,
  tiltAdjustmentDeg,
} from "./core.js?v=17";
import {
  createFaceSessionBoundary,
  createWakeLockController,
} from "./lifecycle.js?v=13";
import {
  FAMOUS_LOCATIONS,
  famousLocationById,
} from "./famous-locations.js?v=3";

const BUILD_VERSION = "1.7";

(() => {

  function buildArrowGeometry(segments = 18) {
    const vertices = [];
    const normals = [];
    const shaftR = 0.105;
    const shaftBottom = -0.62;
    const shaftTop = 0.18;
    const headR = 0.29;
    const headBase = 0.12;
    const tip = [0, 0.98, 0];

    const addTri = (a, b, c) => {
      const ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
      const ac = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
      const n = normalize(cross(ab, ac));
      vertices.push(...a, ...b, ...c);
      normals.push(...n, ...n, ...n);
    };

    for (let i = 0; i < segments; i++) {
      const a0 = i / segments * Math.PI * 2;
      const a1 = (i + 1) / segments * Math.PI * 2;
      const l0 = [Math.cos(a0) * shaftR, shaftBottom, Math.sin(a0) * shaftR];
      const l1 = [Math.cos(a1) * shaftR, shaftBottom, Math.sin(a1) * shaftR];
      const u0 = [Math.cos(a0) * shaftR, shaftTop, Math.sin(a0) * shaftR];
      const u1 = [Math.cos(a1) * shaftR, shaftTop, Math.sin(a1) * shaftR];
      addTri(l0, u0, u1);
      addTri(l0, u1, l1);
      addTri([0, shaftBottom, 0], l1, l0);

      const h0 = [Math.cos(a0) * headR, headBase, Math.sin(a0) * headR];
      const h1 = [Math.cos(a1) * headR, headBase, Math.sin(a1) * headR];
      addTri(h0, tip, h1);
      addTri([0, headBase, 0], h0, h1);
    }

    return {
      vertices: new Float32Array(vertices),
      normals: new Float32Array(normals),
      count: vertices.length / 3,
    };
  }

  class WebGLArrowRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext("webgl", {
        alpha: false,
        antialias: true,
        depth: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: false,
      });
      if (!this.gl) throw new Error("WebGL is unavailable.");
      this.rotation = new Float32Array(9);
      this.viewportScale = new Float32Array(2);
      this.dpr = 1;
      this.buildProgram();
      this.buildGeometry();
      this.resize = this.resize.bind(this);
      window.addEventListener("resize", this.resize, { passive: true });
      this.resize();
    }

    compile(type, source) {
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || "Shader compilation failed.");
      }
      return shader;
    }

    buildProgram() {
      const gl = this.gl;
      const vertex = this.compile(gl.VERTEX_SHADER, `
        attribute vec3 aPosition;
        attribute vec3 aNormal;
        uniform mat3 uRotation;
        uniform vec2 uViewportScale;
        uniform float uFocal;
        varying float vShade;
        void main() {
          vec3 p = uRotation * aPosition;
          vec3 n = normalize(uRotation * aNormal);
          float depth = max(0.65, 3.35 - p.z);
          vec2 projected = vec2(p.x * uViewportScale.x, p.y * uViewportScale.y) * uFocal / depth;
          gl_Position = vec4(projected, 0.18 - p.z * 0.035, 1.0);
          vec3 lightDir = normalize(vec3(-0.45, 0.70, 1.0));
          vShade = 0.30 + 0.70 * abs(dot(n, lightDir));
        }
      `);
      const fragment = this.compile(gl.FRAGMENT_SHADER, `
        precision mediump float;
        varying float vShade;
        uniform float uFacing;
        void main() {
          float base = mix(0.48, 1.0, vShade);
          float glow = uFacing * 0.10;
          gl_FragColor = vec4(vec3(min(1.0, base + glow)), 1.0);
        }
      `);
      const program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || "WebGL program link failed.");
      }
      this.program = program;
      this.aPosition = gl.getAttribLocation(program, "aPosition");
      this.aNormal = gl.getAttribLocation(program, "aNormal");
      this.uRotation = gl.getUniformLocation(program, "uRotation");
      this.uViewportScale = gl.getUniformLocation(program, "uViewportScale");
      this.uFocal = gl.getUniformLocation(program, "uFocal");
      this.uFacing = gl.getUniformLocation(program, "uFacing");
    }

    buildGeometry() {
      const gl = this.gl;
      const geometry = buildArrowGeometry();
      this.count = geometry.count;
      this.positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, geometry.vertices, gl.STATIC_DRAW);
      this.normalBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, geometry.normals, gl.STATIC_DRAW);
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      // 1.5 is visibly crisp on high-density phones while avoiding millions of needless pixels/frame.
      this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.max(1, Math.round(rect.width * this.dpr));
      const height = Math.max(1, Math.round(rect.height * this.dpr));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      const min = Math.min(width, height);
      this.viewportScale[0] = min / width;
      this.viewportScale[1] = min / height;
      this.gl.viewport(0, 0, width, height);
    }

    render(direction, alignmentError) {
      const gl = this.gl;
      rotationMatrixFromY(direction, this.rotation);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.useProgram(this.program);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.enableVertexAttribArray(this.aPosition);
      gl.vertexAttribPointer(this.aPosition, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
      gl.enableVertexAttribArray(this.aNormal);
      gl.vertexAttribPointer(this.aNormal, 3, gl.FLOAT, false, 0, 0);

      gl.uniformMatrix3fv(this.uRotation, false, this.rotation);
      gl.uniform2fv(this.uViewportScale, this.viewportScale);
      gl.uniform1f(this.uFocal, 3.02);
      gl.uniform1f(this.uFacing, clamp(1 - alignmentError / 12, 0, 1));
      gl.drawArrays(gl.TRIANGLES, 0, this.count);
    }
  }

  class CanvasFallbackRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", { alpha: false });
      if (!this.ctx) throw new Error("Canvas is unavailable.");
      this.resize = this.resize.bind(this);
      window.addEventListener("resize", this.resize, { passive: true });
      this.resize();
    }
    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      this.canvas.width = Math.max(1, Math.round(r.width * dpr));
      this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    }
    render(direction, alignmentError) {
      const ctx = this.ctx;
      const w = this.canvas.width, h = this.canvas.height;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      const scale = Math.min(w, h) * 0.33;
      const x = w / 2 + direction[0] * scale;
      const y = h / 2 - direction[1] * scale;
      const zScale = 0.75 + (direction[2] + 1) * 0.18;
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(Math.atan2(x - w / 2, -(y - h / 2)));
      ctx.scale(zScale, zScale);
      ctx.fillStyle = alignmentError < 5 ? "#fff" : "#dedede";
      const L = scale * 1.25;
      ctx.beginPath();
      ctx.moveTo(-L * .09, L * .45);
      ctx.lineTo(-L * .09, -L * .25);
      ctx.lineTo(-L * .25, -L * .25);
      ctx.lineTo(0, -L * .55);
      ctx.lineTo(L * .25, -L * .25);
      ctx.lineTo(L * .09, -L * .25);
      ctx.lineTo(L * .09, L * .45);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  const els = {
    setup: document.querySelector("#setup"),
    gpsStatus: document.querySelector("#gps-status"),
    myCoordinates: document.querySelector("#my-coordinates"),
    refreshLocation: document.querySelector("#refresh-location"),
    copyLocation: document.querySelector("#copy-location"),
    copyLink: document.querySelector("#copy-link"),
    targetSources: document.querySelectorAll('input[name="target-source"]'),
    targetUserPanel: document.querySelector("#target-user-panel"),
    targetFamousPanel: document.querySelector("#target-famous-panel"),
    targetInput: document.querySelector("#target-input"),
    targetError: document.querySelector("#target-error"),
    clearTarget: document.querySelector("#clear-target"),
    famousLocation: document.querySelector("#famous-location"),
    famousCoordinates: document.querySelector("#famous-coordinates"),
    targetStatus: document.querySelector("#target-status"),
    targetPreview: document.querySelector("#target-preview"),
    previewDistance: document.querySelector("#preview-distance"),
    previewHeading: document.querySelector("#preview-heading"),
    previewTilt: document.querySelector("#preview-tilt"),
    setupMessage: document.querySelector("#setup-message"),
    faceButton: document.querySelector("#face-button"),
    faceStage: document.querySelector("#face-stage"),
    exitFace: document.querySelector("#exit-face"),
    faceHint: document.querySelector("#face-hint"),
    faceDistance: document.querySelector("#face-distance"),
    tiltLevel: document.querySelector("#tilt-level"),
    tiltCue: document.querySelector("#tilt-cue"),
    faceTilt: document.querySelector("#face-tilt"),
    sensorWarning: document.querySelector("#sensor-warning"),
    debugPanel: document.querySelector("#debug-panel"),
    debugValues: document.querySelector("#debug-values"),
    copyCheckingDetails: document.querySelector("#copy-checking-details"),
    alignment: document.querySelector("#alignment"),
    alignmentText: document.querySelector("#alignment-text"),
    alignmentStatus: document.querySelector("#alignment-status"),
    canvas: document.querySelector("#arrow-canvas"),
  };

  let renderer = null;
  let rendererError = "";
  let rendererType = "none";
  try {
    renderer = new WebGLArrowRenderer(els.canvas);
    rendererType = "WebGL";
  } catch (error) {
    rendererError = error?.message || String(error);
    console.warn("Face Me WebGL renderer unavailable; using Canvas fallback.", error);
    try {
      renderer = new CanvasFallbackRenderer(els.canvas);
      rendererType = "Canvas fallback";
    } catch (fallbackError) {
      rendererError += ` / ${fallbackError?.message || String(fallbackError)}`;
    }
  }

  const state = {
    current: null,
    target: null,
    accuracy: null,
    targetUnitEnu: null,
    chordDistanceM: null,
    surfaceDistanceM: null,
    rawLocalDirection: null,
    displayDirection: [0, 1, 0],
    sensorSource: "waiting",
    sensorAbsolute: false,
    sensorError: "",
    alpha: null,
    beta: null,
    gamma: null,
    sensorMatrix: null,
    genericSensor: null,
    orientationHandler: null,
    orientationAbsoluteHandler: null,
    debug: false,
    facing: false,
    watchId: null,
    animationId: null,
    lastFrameAt: 0,
    lastUiAt: 0,
    lastDebugAt: 0,
    lastTapAt: 0,
    lastSensorReadingAt: 0,
    lastVibrateAt: 0,
    lastAlignmentText: "",
    lastAlignmentStatus: "",
    lastAlignmentStatusAt: 0,
    orientationFallbackTimer: null,
    sensorWarningTimer: null,
    hintTimer: null,
  };

  const faceSession = createFaceSessionBoundary();
  const wakeLock = createWakeLockController({
    requestLock: () => navigator.wakeLock?.request?.("screen"),
    isSessionCurrent: session => faceSession.isCurrent(session),
  });

  function setMessage(message = "") {
    els.setupMessage.textContent = message;
  }

  function setGpsStatus(text, status = "neutral") {
    els.gpsStatus.textContent = text;
    els.gpsStatus.dataset.state = status;
  }

  function setTargetError(message = "") {
    els.targetError.textContent = message;
  }

  function updateTargetInputError() {
    setTargetError(
      selectedTargetSource() !== "user" || state.target || !els.targetInput.value.trim()
        ? ""
        : "I couldn't read that. Use latitude, longitude — for example: 49.8951, -97.1384"
    );
  }

  function selectedTargetSource() {
    return document.querySelector('input[name="target-source"]:checked')?.value || "user";
  }

  function selectedTarget() {
    if (selectedTargetSource() === "famous") {
      return famousLocationById(els.famousLocation.value);
    }
    return parseCoordinates(els.targetInput.value);
  }

  function setTargetSource(source) {
    const radio = [...els.targetSources].find(input => input.value === source);
    if (radio) radio.checked = true;
    const useFamousLocation = source === "famous";
    els.targetUserPanel.hidden = useFamousLocation;
    els.targetFamousPanel.hidden = !useFamousLocation;
  }

  function populateFamousLocations() {
    const groups = new Map();
    for (const location of FAMOUS_LOCATIONS) {
      let group = groups.get(location.group);
      if (!group) {
        group = document.createElement("optgroup");
        group.label = location.group;
        groups.set(location.group, group);
        els.famousLocation.append(group);
      }
      const option = document.createElement("option");
      option.value = location.id;
      option.textContent = `${location.name} — ${location.country}`;
      group.append(option);
    }
  }

  function updateTargetState() {
    const source = selectedTargetSource();
    const target = selectedTarget();
    const hasInput = source === "famous"
      ? Boolean(els.famousLocation.value)
      : Boolean(els.targetInput.value.trim());
    state.target = target;
    els.faceButton.disabled = !(state.current && target);
    els.targetInput.setAttribute("aria-invalid", String(source === "user" && hasInput && !target));
    els.targetStatus.textContent = target ? "ready" : (hasInput ? "check input" : "waiting");
    els.targetStatus.dataset.state = target ? "good" : (hasInput ? "bad" : "neutral");
    els.famousCoordinates.textContent = source === "famous" && target
      ? formatCoordinates(target, 7)
      : "";
    updateTargetPreview();
  }

  function selectedPointingMode() {
    return document.querySelector("#pointing-mode").value;
  }

  function updateTargetPreview() {
    if (!state.current || !state.target) {
      els.targetPreview.hidden = true;
      return;
    }
    const target = targetDetails(state.current, state.target, selectedPointingMode());
    if (target.chordDistanceM < 0.5) {
      els.targetPreview.hidden = true;
      return;
    }
    const surface = selectedPointingMode() === "surface";
    document.querySelector("#preview-distance-label").textContent = surface ? "Surface distance" : "Direct line";
    els.previewDistance.textContent = formatDistance(surface ? target.surfaceDistanceM : target.chordDistanceM);
    els.previewHeading.textContent = target.vector ? `${fmt(bearingDeg(target.vector), 1)}°` : "No unique heading";
    els.previewTilt.textContent = formatTilt(target.tiltDeg);
    els.targetPreview.hidden = false;
  }

  function updateCurrentLocation(position) {
    state.current = { lat: position.coords.latitude, lon: position.coords.longitude };
    state.accuracy = position.coords.accuracy;
    els.myCoordinates.textContent = formatCoordinates(state.current);
    els.copyLocation.disabled = false;
    els.copyLink.disabled = false;
    const accuracy = Number.isFinite(state.accuracy) ? Math.round(state.accuracy) : null;
    setGpsStatus(accuracy ? `±${accuracy} m` : "ready", accuracy && accuracy <= 30 ? "good" : "neutral");
    updateTargetState();
    if (faceSession.active && !recalculateTargetVector()) void exitFaceMode();
  }

  function locationError(error) {
    const messages = {
      1: "Location permission was denied.",
      2: "Your location is unavailable.",
      3: "Location timed out. Try again.",
    };
    setGpsStatus("location error", "bad");
    setMessage(messages[error.code] || "Could not get your location.");
  }

  async function requestLocation() {
    if (!navigator.geolocation) {
      setGpsStatus("unsupported", "bad");
      setMessage("This browser does not provide geolocation.");
      return;
    }
    setGpsStatus("locating…", "working");
    setMessage("");
    try {
      const permission = await navigator.permissions?.query?.({ name: "geolocation" });
      if (permission?.state === "denied") {
        setGpsStatus("permission denied", "bad");
        setMessage("Location is blocked for this site. In Chrome, open site controls beside the address, allow Location, then tap Refresh.");
        return;
      }
    } catch {}
    navigator.geolocation.getCurrentPosition(updateCurrentLocation, locationError, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 30000,
    });
  }

  function startLocationWatch(session) {
    if (!navigator.geolocation || state.watchId !== null) return;
    state.watchId = navigator.geolocation.watchPosition(position => {
      if (faceSession.isCurrent(session)) updateCurrentLocation(position);
    }, () => {}, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 3000,
    });
  }

  function stopLocationWatch() {
    if (state.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
  }

  function recalculateTargetVector() {
    if (!state.current || !state.target) return false;
    const target = targetDetails(state.current, state.target, selectedPointingMode());
    if (target.chordDistanceM < 0.5) {
      setMessage("Those coordinates are effectively your current location, so there is no direction to point.");
      return false;
    }
    if (!target.vector) {
      setMessage("Opposite points on Earth have no unique surface heading. Choose Through Earth mode or a different target.");
      return false;
    }
    state.targetUnitEnu = target.vector;
    state.chordDistanceM = target.chordDistanceM;
    state.surfaceDistanceM = target.surfaceDistanceM;
    els.faceDistance.textContent = selectedPointingMode() === "surface"
      ? `surface ${formatDistance(state.surfaceDistanceM)}`
      : `direct ${formatDistance(state.chordDistanceM)}`;
    els.faceTilt.textContent = formatTilt(target.tiltDeg);
    return true;
  }

  function setRawLocalDirection(local) {
    if (!local) return;
    state.rawLocalDirection = normalize(local);
    state.lastSensorReadingAt = performance.now();
    els.sensorWarning.hidden = true;
  }

  function updateDirectionFromSensorState() {
    if (!state.targetUnitEnu || !state.sensorAbsolute) return;
    if (state.sensorMatrix) {
      state.localUp = earthToLocalFromSensorMatrix(state.sensorMatrix, [0, 0, 1]);
      setRawLocalDirection(earthToLocalFromSensorMatrix(state.sensorMatrix, state.targetUnitEnu));
      return;
    }
    if ([state.alpha, state.beta, state.gamma].every(Number.isFinite)) {
      const matrix = deviceOrientationMatrix(state.alpha, state.beta, state.gamma);
      state.localUp = earthToLocalFromRowMajorMatrix(matrix, [0, 0, 1]);
      setRawLocalDirection(earthToLocalFromRowMajorMatrix(matrix, state.targetUnitEnu));
    }
  }

  function onDeviceOrientation(event, source, session) {
    if (!faceSession.isCurrent(session)) return;
    if (![event.alpha, event.beta, event.gamma].every(Number.isFinite)) return;
    state.sensorSource = source;
    state.sensorAbsolute = event.absolute === true || source === "deviceorientationabsolute";
    state.alpha = event.alpha;
    state.beta = event.beta;
    state.gamma = event.gamma;
    state.sensorMatrix = null;
    if (!state.sensorAbsolute) {
      // Relative angles have no north reference, so they cannot locate the target.
      state.rawLocalDirection = null;
      state.localUp = null;
      state.displayTilt = null;
      state.lastSensorReadingAt = 0;
      return;
    }
    updateDirectionFromSensorState();
  }

  function clearOrientationFallbackTimer() {
    if (state.orientationFallbackTimer !== null) {
      clearTimeout(state.orientationFallbackTimer);
      state.orientationFallbackTimer = null;
    }
  }

  function stopGenericOrientationSensor() {
    if (!state.genericSensor) return;
    try { state.genericSensor.stop(); } catch {}
    state.genericSensor = null;
  }

  function detachOrientationEventFallback() {
    if (state.orientationAbsoluteHandler) {
      window.removeEventListener("deviceorientationabsolute", state.orientationAbsoluteHandler, true);
      state.orientationAbsoluteHandler = null;
    }
    if (state.orientationHandler) {
      window.removeEventListener("deviceorientation", state.orientationHandler, true);
      state.orientationHandler = null;
    }
  }

  function startOrientation(session) {
    if (!faceSession.isCurrent(session)) return;
    stopOrientation();
    state.sensorError = "";
    state.sensorSource = "starting";
    state.lastSensorReadingAt = 0;

    if ("AbsoluteOrientationSensor" in window) {
      try {
        const sensor = new AbsoluteOrientationSensor({ frequency: 60, referenceFrame: "screen" });
        state.genericSensor = sensor;
        sensor.addEventListener("reading", () => {
          if (!faceSession.isCurrent(session) || state.genericSensor !== sensor) return;
          try {
            const matrix = new Float32Array(16);
            sensor.populateMatrix(matrix);
            clearOrientationFallbackTimer();
            detachOrientationEventFallback();
            state.sensorMatrix = matrix;
            state.sensorSource = "AbsoluteOrientationSensor(screen)";
            state.sensorAbsolute = true;
            updateDirectionFromSensorState();
          } catch (error) {
            state.sensorError = error?.message || String(error);
          }
        });
        sensor.addEventListener("error", event => {
          if (!faceSession.isCurrent(session) || state.genericSensor !== sensor) return;
          state.sensorError = `${event.error?.name || "SensorError"}: ${event.error?.message || "unavailable"}`;
          attachOrientationEventFallback(session);
        });
        sensor.start();
        const fallbackTimer = window.setTimeout(() => {
          if (state.orientationFallbackTimer === fallbackTimer) {
            state.orientationFallbackTimer = null;
          }
          if (faceSession.isCurrent(session) && state.genericSensor === sensor && !state.lastSensorReadingAt) {
            attachOrientationEventFallback(session, { keepGenericSensor: true });
          }
        }, 700);
        state.orientationFallbackTimer = fallbackTimer;
        return;
      } catch (error) {
        state.sensorError = `${error?.name || "SensorError"}: ${error?.message || "unavailable"}`;
      }
    }
    attachOrientationEventFallback(session);
  }

  function attachOrientationEventFallback(session, { keepGenericSensor = false } = {}) {
    if (!faceSession.isCurrent(session)) return;
    clearOrientationFallbackTimer();
    // A startup fallback may bridge a slow first generic-sensor reading. Sensor errors make a full handoff.
    if (!keepGenericSensor) stopGenericOrientationSensor();
    state.sensorMatrix = null;
    if (state.orientationHandler || state.orientationAbsoluteHandler) return;
    state.orientationAbsoluteHandler = event => onDeviceOrientation(event, "deviceorientationabsolute", session);
    state.orientationHandler = event => {
      if (state.sensorSource !== "deviceorientationabsolute") {
        onDeviceOrientation(event, "deviceorientation", session);
      }
    };
    window.addEventListener("deviceorientationabsolute", state.orientationAbsoluteHandler, true);
    window.addEventListener("deviceorientation", state.orientationHandler, true);
  }

  function stopOrientation() {
    clearOrientationFallbackTimer();
    stopGenericOrientationSensor();
    detachOrientationEventFallback();
    state.sensorMatrix = null;
  }

  async function requestOrientationPermission() {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      const result = await DeviceOrientationEvent.requestPermission(true);
      if (result !== "granted") throw new Error("Orientation permission was denied.");
    }
  }

  function requestWakeLock(session) {
    return wakeLock.acquire(session);
  }

  function releaseWakeLock() {
    return wakeLock.release();
  }

  function shareUrlForCurrentLocation() {
    if (!state.current) return null;
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("lat", state.current.lat.toFixed(6));
    url.searchParams.set("lon", state.current.lon.toFixed(6));
    return url.toString();
  }

  function applyTargetFromUrl() {
    const target = parseCoordinatesFromSearch(window.location.search);
    if (!target) return false;
    setTargetSource("user");
    els.targetInput.value = formatCoordinates(target);
    updateTargetState();
    return true;
  }

  const ALIGNMENT_STATUS_TEXT = {
    acquiring: "Acquiring direction.",
    off: "Target is off alignment.",
    close: "Close to target alignment.",
    facing: "Facing target.",
  };

  function setAccessibleAlignmentStatus(status, now, immediate = false) {
    if (status === state.lastAlignmentStatus) return;
    if (!immediate && now - state.lastAlignmentStatusAt < 1300) return;
    state.lastAlignmentStatus = status;
    state.lastAlignmentStatusAt = now;
    els.alignmentStatus.textContent = ALIGNMENT_STATUS_TEXT[status];
  }

  function hasFreshOrientation(now) {
    return Boolean(state.rawLocalDirection && state.sensorAbsolute
      && now - state.lastSensorReadingAt < 2000);
  }

  function updateAlignmentUi(error, now) {
    if (now - state.lastUiAt < 90) return;
    state.lastUiAt = now;
    const freshTilt = state.displayTilt !== null && hasFreshOrientation(now);
    const tilt = state.displayTilt;
    const matched = freshTilt && Math.abs(tilt) < 3;
    els.tiltLevel.dataset.state = freshTilt ? (matched ? "matched" : "adjust") : "waiting";
    els.tiltLevel.style.setProperty("--bubble-offset", `${freshTilt && !matched ? -clamp(tilt / 45, -1, 1) * 43 : 0}px`);
    const cue = !freshTilt ? "Waiting" : matched ? "Matched" : tilt > 0 ? "Tilt up" : "Tilt down";
    if (els.tiltCue.textContent !== cue) {
      els.tiltCue.textContent = cue;
      els.tiltLevel.setAttribute("aria-label", `Top edge tilt: ${cue.toLowerCase()}`);
    }
    const facing = error < 5;
    const close = error < 12;
    setAccessibleAlignmentStatus(facing ? "facing" : (close ? "close" : "off"), now);
    const text = facing ? "FACING" : `${Math.round(error)}° OFF`;
    if (text !== state.lastAlignmentText) {
      els.alignmentText.textContent = text;
      state.lastAlignmentText = text;
    }
    els.alignment.classList.toggle("is-close", close);
    els.alignment.classList.toggle("is-facing", facing);
    els.faceStage.classList.toggle("is-facing", facing);

    if (facing && !state.facing && now - state.lastVibrateAt > 900) {
      state.lastVibrateAt = now;
      try { navigator.vibrate?.(28); } catch {}
    }
    state.facing = facing;
  }

  function updateDebugPanel(now) {
    if (!state.debug || !faceSession.active || now - state.lastDebugAt < 240) return;
    state.lastDebugAt = now;
    const enu = state.targetUnitEnu || [NaN, NaN, NaN];
    const local = state.rawLocalDirection || [NaN, NaN, NaN];
    const rows = [
      ["renderer", rendererType],
      ["sensor", state.sensorSource],
      ["absolute", state.sensorAbsolute ? "yes" : "NO / uncertain"],
      ["sensor age", state.lastSensorReadingAt ? `${Math.round(now - state.lastSensorReadingAt)} ms` : "—"],
      ["sensor error", state.sensorError || rendererError || "—"],
      ["you", state.current ? formatCoordinates(state.current) : "—"],
      ["mode", selectedPointingMode()],
      ["target", state.target ? formatCoordinates(state.target) : "—"],
      ["GPS accuracy", Number.isFinite(state.accuracy) ? `±${Math.round(state.accuracy)} m` : "—"],
      ["surface", formatDistance(state.surfaceDistanceM)],
      ["direct chord", formatDistance(state.chordDistanceM)],
      ["bearing", `${fmt(bearingDeg(enu), 1)}° true`],
      ["target tilt", `${fmt(inclinationDeg(enu), 1)}°`],
      ["ENU unit", `[${fmt(enu[0], 3)}, ${fmt(enu[1], 3)}, ${fmt(enu[2], 3)}]`],
      ["phone unit", `[${fmt(local[0], 3)}, ${fmt(local[1], 3)}, ${fmt(local[2], 3)}]`],
      ["alignment", state.rawLocalDirection ? `${fmt(angleDegBetween(local, ALIGNMENT_AXIS), 1)}°` : "—"],
      ["α β γ", `[${fmt(state.alpha, 1)}, ${fmt(state.beta, 1)}, ${fmt(state.gamma, 1)}]`],
      ["screen", `${screen.orientation?.type || "unknown"} ${screen.orientation?.angle ?? 0}°`],
      ["north note", "absolute frame may be magnetic north"],
    ];

    const fragment = document.createDocumentFragment();
    for (const [key, value] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      dd.textContent = value;
      fragment.append(dt, dd);
    }
    els.debugValues.replaceChildren(fragment);
  }

  function selectedTargetDescription() {
    if (selectedTargetSource() !== "famous") return { name: "User input", nominalHeading: null };
    const location = famousLocationById(els.famousLocation.value);
    return {
      name: location ? `${location.name} — ${location.country}` : "Unknown target",
      nominalHeading: Number.isFinite(location?.checkHeadingDeg) ? location.checkHeadingDeg : null,
    };
  }

  function formatVector(vector, digits = 6) {
    return vector
      ? `[${Array.from(vector, value => fmt(value, digits)).join(", ")}]`
      : "—";
  }

  function checkingDetails() {
    const now = performance.now();
    const enu = state.targetUnitEnu;
    const local = state.rawLocalDirection;
    const targetDescription = selectedTargetDescription();
    const orientationMatrix = state.sensorMatrix
      ? Array.from(state.sensorMatrix)
      : ([state.alpha, state.beta, state.gamma].every(Number.isFinite)
        ? deviceOrientationMatrix(state.alpha, state.beta, state.gamma)
        : null);
    const orientationKind = state.sensorMatrix ? "sensor 4×4, column-major" : "event 3×3, row-major";

    return [
      "FACE ME POINTING CHECK",
      `Build: Face Me v${BUILD_VERSION}`,
      `Pointing mode: ${selectedPointingMode()}`,
      `Captured: ${new Date().toISOString()}`,
      `Target choice: ${targetDescription.name}`,
      `Nominal table heading: ${targetDescription.nominalHeading === null ? "not applicable" : `${String(targetDescription.nominalHeading).padStart(3, "0")}° true`}`,
      `Live expected heading: ${enu ? `${fmt(bearingDeg(enu), 3)}° true` : "—"}`,
      `Live expected target tilt: ${enu ? `${fmt(inclinationDeg(enu), 3)}°` : "—"}`,
      `Your GPS: ${state.current ? formatCoordinates(state.current, 7) : "—"}`,
      `GPS accuracy: ${Number.isFinite(state.accuracy) ? `±${fmt(state.accuracy, 1)} m` : "—"}`,
      `Target GPS: ${state.target ? formatCoordinates(state.target, 7) : "—"}`,
      `Surface distance: ${Number.isFinite(state.surfaceDistanceM) ? `${fmt(state.surfaceDistanceM, 1)} m` : "—"}`,
      `Direct chord: ${Number.isFinite(state.chordDistanceM) ? `${fmt(state.chordDistanceM, 1)} m` : "—"}`,
      `Target ENU unit: ${formatVector(enu)}`,
      "",
      "OBSERVATION (fill these in after pasting)",
      "Reference compass heading: ___°",
      "Reference compass north: magnetic / true",
      "Phone: flat, screen up: yes / no",
      "Arrow points toward top edge: yes / no / unclear",
      "What the arrow appeared to do: ___",
      "",
      "SENSOR SNAPSHOT",
      `Sensor path: ${state.sensorSource}`,
      `Sensor says absolute: ${state.sensorAbsolute ? "yes" : "no / uncertain"}`,
      `Sensor age: ${state.lastSensorReadingAt ? `${Math.round(now - state.lastSensorReadingAt)} ms` : "—"}`,
      `Sensor error: ${state.sensorError || rendererError || "—"}`,
      `Raw target in phone frame: ${formatVector(local)}`,
      `Smoothed display vector: ${formatVector(state.displayDirection)}`,
      `Raw top-edge alignment error: ${local ? `${fmt(angleDegBetween(local, ALIGNMENT_AXIS), 3)}°` : "—"}`,
      `α β γ: [${fmt(state.alpha, 3)}, ${fmt(state.beta, 3)}, ${fmt(state.gamma, 3)}]`,
      `Orientation matrix (${orientationKind}): ${formatVector(orientationMatrix)}`,
      `Screen: ${screen.orientation?.type || "unknown"} ${screen.orientation?.angle ?? 0}°`,
      `Renderer: ${rendererType}`,
      `User agent: ${navigator.userAgent}`,
      "North-frame caveat: browser absolute orientation may use magnetic rather than true north.",
    ].join("\n");
  }

  function frame(now) {
    if (!faceSession.active) {
      state.animationId = null;
      return;
    }

    const dt = state.lastFrameAt ? Math.min(50, now - state.lastFrameAt) : 16.7;
    state.lastFrameAt = now;

    const directionAvailable = hasFreshOrientation(now);
    const visibility = directionAvailable ? "visible" : "hidden";
    const availabilityChanged = els.canvas.style.visibility !== visibility;
    if (availabilityChanged) els.canvas.style.visibility = visibility;
    if (directionAvailable) {
      state.displayDirection = smoothDirection(state.displayDirection, state.rawLocalDirection, dt);
      if (state.localUp) {
        const tilt = tiltAdjustmentDeg(state.targetUnitEnu, state.localUp);
        state.displayTilt = state.displayTilt === null ? tilt
          : state.displayTilt + (tilt - state.displayTilt) * (1 - Math.exp(-dt / 140));
      }
      const error = angleDegBetween(state.displayDirection, ALIGNMENT_AXIS);
      renderer?.render(state.displayDirection, error);
      updateAlignmentUi(error, now);
    } else {
      state.displayTilt = null;
      if (availabilityChanged || state.lastAlignmentStatus !== "acquiring" || now - state.lastUiAt >= 90) {
        state.lastUiAt = now;
        state.facing = false;
        state.lastAlignmentText = "acquiring direction…";
        els.alignmentText.textContent = state.lastAlignmentText;
        els.alignment.classList.remove("is-close", "is-facing");
        els.faceStage.classList.remove("is-facing");
        els.tiltLevel.dataset.state = "waiting";
        els.tiltLevel.style.setProperty("--bubble-offset", "0px");
        els.tiltCue.textContent = "Waiting";
        els.tiltLevel.setAttribute("aria-label", "Top edge tilt: waiting for sensor");
        setAccessibleAlignmentStatus("acquiring", now, true);
        if (state.rawLocalDirection || (state.sensorSource === "deviceorientation" && !state.sensorAbsolute)) {
          els.sensorWarning.hidden = false;
        }
      }
    }

    updateDebugPanel(now);
    state.animationId = requestAnimationFrame(frame);
  }

  function startAnimation() {
    if (state.animationId !== null) return;
    state.lastFrameAt = 0;
    state.lastUiAt = 0;
    state.animationId = requestAnimationFrame(frame);
  }

  function stopAnimation() {
    if (state.animationId !== null) cancelAnimationFrame(state.animationId);
    state.animationId = null;
    state.lastFrameAt = 0;
  }

  function clearFaceSessionTimers() {
    clearOrientationFallbackTimer();
    clearTimeout(state.sensorWarningTimer);
    clearTimeout(state.hintTimer);
    state.sensorWarningTimer = null;
    state.hintTimer = null;
  }

  function resetFaceSessionTelemetry() {
    state.facing = false;
    state.rawLocalDirection = null;
    state.localUp = null;
    state.displayTilt = null;
    els.tiltLevel.dataset.state = "waiting";
    els.tiltCue.textContent = "Waiting";
    els.tiltLevel.setAttribute("aria-label", "Top edge tilt: waiting for sensor");
    state.displayDirection = [0, 1, 0];
    state.sensorSource = "starting";
    state.sensorAbsolute = false;
    state.sensorError = "";
    state.alpha = null;
    state.beta = null;
    state.gamma = null;
    state.sensorMatrix = null;
    state.lastAlignmentText = "";
    state.lastAlignmentStatus = "";
    state.lastAlignmentStatusAt = 0;
    state.lastSensorReadingAt = 0;
    state.lastDebugAt = 0;
    state.lastTapAt = 0;
    state.lastVibrateAt = 0;
  }

  function scheduleSensorWarning(session) {
    clearTimeout(state.sensorWarningTimer);
    state.sensorWarningTimer = setTimeout(() => {
      state.sensorWarningTimer = null;
      if (faceSession.isCurrent(session) && !state.lastSensorReadingAt) {
        els.sensorWarning.hidden = false;
      }
    }, 2600);
  }

  async function requestFullscreenForSession(session) {
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      }
    } catch {}

    // A newer active session can adopt the same global browser presentation state.
    if (!faceSession.isCurrent(session) && !faceSession.active && document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch {}
    }
  }

  async function lockOrientationForSession(session) {
    try {
      if (screen.orientation?.lock) await screen.orientation.lock("portrait");
    } catch {}

    if (!faceSession.isCurrent(session) && !faceSession.active) {
      try { screen.orientation?.unlock?.(); } catch {}
    }
  }

  async function enterFaceMode() {
    if (faceSession.active) return;
    state.target = selectedTarget();
    if (!state.current || !state.target) {
      setMessage("Set both locations first.");
      return;
    }
    if (!recalculateTargetVector()) return;

    setMessage("");
    const session = faceSession.begin();
    clearFaceSessionTimers();
    resetFaceSessionTelemetry();
    els.alignmentText.textContent = "acquiring direction…";
    els.alignment.classList.remove("is-close", "is-facing");
    els.faceStage.classList.remove("is-facing");
    els.sensorWarning.hidden = true;
    els.setup.hidden = true;
    els.faceStage.hidden = false;
    renderer?.resize?.();

    // Do the gesture-gated browser UI requests immediately while user activation is fresh.
    const fullscreenPromise = requestFullscreenForSession(session);
    const orientationLockPromise = lockOrientationForSession(session);
    els.exitFace.focus({ preventScroll: true });
    setAccessibleAlignmentStatus("acquiring", performance.now(), true);

    startLocationWatch(session);
    startAnimation();
    scheduleSensorWarning(session);
    requestWakeLock(session);

    els.faceHint.classList.remove("fade");
    clearTimeout(state.hintTimer);
    state.hintTimer = setTimeout(() => {
      state.hintTimer = null;
      if (faceSession.isCurrent(session)) els.faceHint.classList.add("fade");
    }, 4200);

    try {
      await requestOrientationPermission();
      if (!faceSession.isCurrent(session)) return;
      startOrientation(session);
    } catch (error) {
      if (!faceSession.isCurrent(session)) return;
      state.sensorError = error?.message || String(error);
      state.sensorSource = "permission denied";
      attachOrientationEventFallback(session);
    }

    await Promise.allSettled([fullscreenPromise, orientationLockPromise]);
    if (!faceSession.isCurrent(session)) return;
  }

  async function exitFaceMode() {
    faceSession.invalidate();
    stopAnimation();
    stopOrientation();
    stopLocationWatch();
    releaseWakeLock();
    clearFaceSessionTimers();
    els.faceStage.hidden = true;
    els.setup.hidden = false;
    const setupFocusTarget = els.faceButton.disabled
      ? (selectedTargetSource() === "famous" ? els.famousLocation : els.targetInput)
      : els.faceButton;
    setupFocusTarget.focus({ preventScroll: true });
    state.debug = false;
    els.debugPanel.hidden = true;
    els.faceStage.classList.remove("is-facing");
    els.alignment.classList.remove("is-close", "is-facing");
    els.alignmentText.textContent = "acquiring direction…";
    els.alignmentStatus.textContent = "";
    state.lastAlignmentStatus = "";
    state.lastAlignmentStatusAt = 0;
    try { screen.orientation?.unlock?.(); } catch {}
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch {}
    applyPendingUpdate();
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const temp = document.createElement("textarea");
    temp.value = text;
    temp.style.position = "fixed";
    temp.style.opacity = "0";
    document.body.append(temp);
    temp.select();
    document.execCommand("copy");
    temp.remove();
  }

  function momentaryButtonLabel(button, text, restore, delay = 1150) {
    button.textContent = text;
    setTimeout(() => { button.textContent = restore; }, delay);
  }

  els.refreshLocation.addEventListener("click", requestLocation);
  els.copyLocation.addEventListener("click", async () => {
    if (!state.current) return;
    try {
      await copyText(formatCoordinates(state.current));
      momentaryButtonLabel(els.copyLocation, "Copied", "Copy coords");
    } catch {
      setMessage("Could not copy automatically. Press and hold the coordinates instead.");
    }
  });

  els.copyLink.addEventListener("click", async () => {
    const url = shareUrlForCurrentLocation();
    if (!url) return;
    try {
      await copyText(url);
      momentaryButtonLabel(els.copyLink, "Link copied", "Copy link");
    } catch {
      setMessage("Could not copy the link automatically.");
    }
  });

  els.copyCheckingDetails.addEventListener("click", async event => {
    event.stopPropagation();
    try {
      await copyText(checkingDetails());
      momentaryButtonLabel(els.copyCheckingDetails, "Checking details copied", "Copy checking details", 1600);
    } catch {
      momentaryButtonLabel(els.copyCheckingDetails, "Could not copy", "Copy checking details", 1600);
    }
  });

  document.querySelector("#pointing-mode").addEventListener("change", () => {
    document.querySelector("#mode-hint").textContent = selectedPointingMode() === "surface"
      ? "Follow the initial great-circle heading along Earth's surface. The arrow stays horizontal."
      : "Point along the straight line to them, through the Earth. Distant targets point below the horizon.";
    setMessage("");
    updateTargetPreview();
  });

  els.targetInput.addEventListener("input", () => {
    updateTargetState();
    setMessage("");
    updateTargetInputError();
  });

  for (const input of els.targetSources) {
    input.addEventListener("change", () => {
      setTargetSource(input.value);
      setMessage("");
      updateTargetState();
      updateTargetInputError();
    });
  }

  els.famousLocation.addEventListener("change", () => {
    setMessage("");
    updateTargetState();
  });

  els.clearTarget.addEventListener("click", () => {
    els.targetInput.value = "";
    updateTargetState();
    setMessage("");
    setTargetError("");
    els.targetInput.focus();
  });

  els.faceButton.addEventListener("click", enterFaceMode);
  els.exitFace.addEventListener("click", event => {
    event.stopPropagation();
    exitFaceMode();
  });

  els.faceStage.addEventListener("pointerup", event => {
    if (event.target === els.exitFace || els.debugPanel.contains(event.target)) return;
    const now = performance.now();
    if (now - state.lastTapAt < 330) {
      state.debug = !state.debug;
      els.debugPanel.hidden = !state.debug;
      state.lastDebugAt = 0;
      state.lastTapAt = 0;
    } else {
      state.lastTapAt = now;
    }
  });

  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && faceSession.active) exitFaceMode();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && faceSession.active) {
      requestWakeLock(faceSession.generation);
    }
  });

  const updateDraftKey = "face-me-update-draft";
  let updatePending = false;
  let reloadingForUpdate = false;

  function applyPendingUpdate() {
    if (!updatePending || reloadingForUpdate || faceSession.active) return;
    // Keep in-progress input only across this update, not future app launches.
    try {
      sessionStorage.setItem(updateDraftKey, JSON.stringify({
        input: els.targetInput.value,
        source: selectedTargetSource(),
        famous: els.famousLocation.value,
      }));
    } catch {
      // If storage is disabled, wait until the user has cleared their input.
      if (els.targetInput.value || els.famousLocation.value) return;
    }
    reloadingForUpdate = true;
    window.location.reload();
  }

  if ("serviceWorker" in navigator) {
    let hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // Initial installation doesn't require a reload.
      if (hadController) {
        updatePending = true;
        applyPendingUpdate();
      }
      hadController = true;
    });
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
        const check = () => {
          if (document.visibilityState === "visible") registration.update().catch(() => {});
          applyPendingUpdate();
        };
        document.addEventListener("visibilitychange", check);
        window.addEventListener("online", check);
        window.setInterval(check, 5 * 60 * 1000);
        check();
      } catch { /* Offline startup can still use the installed worker. */ }
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }

  populateFamousLocations();
  applyTargetFromUrl();
  try {
    const draft = JSON.parse(sessionStorage.getItem(updateDraftKey) || "null");
    sessionStorage.removeItem(updateDraftKey);
    if (draft) {
      els.targetInput.value = draft.input;
      els.famousLocation.value = draft.famous;
      setTargetSource(draft.source);
    }
  } catch { /* Storage may be disabled. */ }
  requestLocation();
  updateTargetState();
})();
