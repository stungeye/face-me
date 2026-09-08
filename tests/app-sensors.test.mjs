import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as core from "../core.js";
import { normalizeOrientationEvent, transformEarthToPhone } from "../orientation-service.js";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
// Run the production event/animation functions with browser surfaces replaced.
function functionSource(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `Missing production function ${name}`);
  const end = source.indexOf("\n  }", start) + 4;
  return source.slice(start, end);
}

export function sensorHarness() {
  let now = 100;
  const element = () => {
    const classes = new Set();
    return {
      hidden: true, textContent: "", dataset: {},
      style: { setProperty() {} }, setAttribute() {},
      classList: {
        remove(...names) { names.forEach(name => classes.delete(name)); },
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); },
      },
    };
  };
  const els = Object.fromEntries([
    "faceLocationWarning", "portraitGuidance", "canvas", "sensorWarning", "alignmentText", "alignment", "faceStage", "tiltLevel", "tiltCue", "alignmentStatus",
  ].map(name => [name, element()]));
  const state = {
    locationTimestamp: Date.now(),
    targetUnitEnu: [0, 1, 0], rawLocalDirection: null, sensorAbsolute: false,
    displayDirection: [0, 1, 0], localUp: null, displayTilt: null,
    lastSensorReadingAt: 0, lastFrameAt: 0, lastUiAt: 0, lastVibrateAt: 0,
  };
  const renders = [];
  const vibrations = [];
  const context = vm.createContext({
    screen: { orientation: { angle: 0 } }, window: {}, locationService: { snapshot: { error: null } },
    ...core, transformEarthToPhone, state, els, performance: { now: () => now },
    faceSession: { active: true, isCurrent: session => session === 1 },
    renderer: { render(...args) { renders.push(args); } }, requestAnimationFrame: () => 1,
    updateDebugPanel() {}, navigator: { vibrate: value => vibrations.push(value) },
    ALIGNMENT_STATUS_TEXT: { acquiring: "Acquiring direction.", off: "Off", close: "Close", facing: "Facing target." },
  });
  const names = ["setRawLocalDirection", "updateDirectionFromSensorState", "setAccessibleAlignmentStatus", "hasFreshOrientation", "updateAlignmentUi", "frame"];
  vm.runInContext(names.map(functionSource).join("\n"), context);
  return {
    state, els, renders, vibrations,
    screen: context.screen, locationService: context.locationService,
    reading(event, source = "deviceorientation") {
      const reading = normalizeOrientationEvent(event, source, now);
      state.orientationReading = reading;
      state.sensorSource = source;
      state.sensorAbsolute = Boolean(reading);
      if (reading) context.updateDirectionFromSensorState();
      else { state.rawLocalDirection = null; state.localUp = null; state.lastSensorReadingAt = 0; }
    },
    frame(time = now) { now = time; context.frame(time); },
  };
}

test("relative orientation cannot establish direction and absolute readings recover", () => {
  const app = sensorHarness();
  app.reading({ alpha: 0, beta: 0, gamma: 0, absolute: false });
  app.frame();
  assert.equal(app.state.rawLocalDirection, null);
  assert.equal(app.state.lastSensorReadingAt, 0);
  assert.equal(app.els.alignmentText.textContent, "acquiring direction…");
  assert.equal(app.els.sensorWarning.hidden, false);
  app.reading({ alpha: 0, beta: 0, gamma: 0, absolute: true });
  app.frame(200);
  assert.equal(app.els.alignmentText.textContent, "FACING");
  assert.equal(app.els.sensorWarning.hidden, true);
});

test("losing the absolute reference clears previous alignment on the next frame", () => {
  const app = sensorHarness();
  app.reading({ alpha: 0, beta: 0, gamma: 0, absolute: true });
  app.frame();
  assert.equal(app.state.facing, true);
  app.reading({ alpha: 0, beta: 0, gamma: 0, absolute: false });
  app.frame(200);
  assert.equal(app.state.facing, false);
  assert.equal(app.state.localUp, null);
  assert.equal(app.els.alignmentStatus.textContent, "Acquiring direction.");
  assert.equal(app.els.sensorWarning.hidden, false);
  app.reading({ alpha: 0, beta: 0, gamma: 0 }, "deviceorientationabsolute");
  app.frame(300);
  assert.equal(app.state.facing, true);
});


test("expired orientation clears alignment, tilt and arrow, and fresh telemetry recovers", () => {
  const app = sensorHarness();
  app.frame(1000);
  app.reading({ alpha: 0, beta: 0, gamma: 0, absolute: true });
  app.frame(1100);
  assert.equal(app.state.facing, true);
  assert.equal(app.els.alignment.classList.contains("is-facing"), true);
  assert.equal(app.els.canvas.style.visibility, "visible");
  assert.equal(app.vibrations.length, 1);
  app.frame(2999);
  assert.equal(app.state.facing, true);
  const renderCount = app.renders.length;
  // Expiration must override the normal 90 ms UI throttle.
  app.frame(3000);
  assert.equal(app.state.facing, false);
  assert.equal(app.els.alignment.classList.contains("is-facing"), false);
  assert.equal(app.els.alignment.classList.contains("is-close"), false);
  assert.equal(app.els.faceStage.classList.contains("is-facing"), false);
  assert.equal(app.els.alignmentStatus.textContent, "Acquiring direction.");
  assert.equal(app.els.tiltLevel.dataset.state, "waiting");
  assert.equal(app.els.tiltCue.textContent, "Waiting");
  assert.equal(app.els.sensorWarning.hidden, false);
  assert.equal(app.els.canvas.style.visibility, "hidden");
  app.frame(5000);
  assert.equal(app.renders.length, renderCount);
  assert.equal(app.vibrations.length, 1);
  app.reading({ alpha: 0, beta: 0, gamma: 0, absolute: true });
  app.frame(5100);
  assert.equal(app.state.facing, true);
  assert.equal(app.els.alignmentStatus.textContent, "Facing target.");
  assert.equal(app.els.canvas.style.visibility, "visible");
  assert.equal(app.els.sensorWarning.hidden, true);
  assert.equal(app.vibrations.length, 2);
});

test("initial acquisition keeps the arrow hidden until valid telemetry arrives", () => {
  const app = sensorHarness();
  app.frame();
  assert.equal(app.renders.length, 0);
  assert.equal(app.els.canvas.style.visibility, "hidden");
  assert.equal(app.els.alignmentStatus.textContent, "Acquiring direction.");
  assert.equal(app.vibrations.length, 0);
});


test("missing or expired GPS prevents stale alignment and fresh GPS recovers", () => {

  const app = sensorHarness();

  app.reading({alpha:0,beta:0,gamma:0,absolute:true}); app.frame();

  assert.equal(app.state.facing,true);

  app.state.locationTimestamp = null; app.frame(200);

  assert.equal(app.state.facing,false);

  assert.equal(app.els.canvas.style.visibility,"hidden");

  assert.equal(app.els.alignmentText.textContent,"acquiring location\u2026");

  app.state.locationTimestamp = Date.now()-31000; app.frame(300);

  assert.equal(app.state.facing,false);

  app.state.locationTimestamp = Date.now(); app.frame(400);

  assert.equal(app.state.facing,true);

});


test("location failure diagnostics remain available without GPS or orientation", () => {
  const context=vm.createContext({
    performance:{now:()=>100},state:{sensorSource:"waiting"}, BUILD_VERSION:"test",
    selectedTargetDescription:()=>({name:"User input",nominalHeading:null}),selectedPointingMode:()=>"surface",
    locationService:{snapshot:{state:"error",permission:"denied",error:{message:"Location blocked"},transitions:[]}},
    orientationService:{snapshot:{transitions:[]}},screen:{},navigator:{userAgent:"test browser"},rendererType:"Canvas",rendererError:"",
    ...core,
  });
  vm.runInContext(["formatVector","checkingDetails"].map(functionSource).join("\n"),context);
  const details=context.checkingDetails();
  assert.match(details,/GPS service: error; permission: denied; error: Location blocked/);
  assert.match(details,/Orientation quality: unavailable/);
  assert.match(details,/Orientation matrix \(Earth ENU to physical phone, columns\)/);
});

test("location recovery clears only the location-owned setup message", () => {
  const els={setupMessage:{textContent:"GPS failed"}};
  const context=vm.createContext({els});
  vm.runInContext('let locationMessage="GPS failed";'+["setMessage","clearLocationMessage"].map(functionSource).join("\n"),context);
  context.clearLocationMessage();assert.equal(els.setupMessage.textContent,"");
  vm.runInContext('locationMessage="GPS failed";',context);
  els.setupMessage.textContent="Could not copy link";context.clearLocationMessage();
  assert.equal(els.setupMessage.textContent,"Could not copy link");
});



test("location errors and non-upright screen rotations suppress alignment with specific guidance", () => {
  const app=sensorHarness();app.reading({alpha:0,beta:0,gamma:0,absolute:true});app.frame();
  app.locationService.snapshot.error={code:2};app.frame(200);
  assert.equal(app.state.facing,false);assert.equal(app.els.faceLocationWarning.hidden,false);
  app.locationService.snapshot.error=null;
  for(const angle of [90,180,270]) {
    app.screen.orientation.angle=angle;app.frame(300+angle);
    assert.equal(app.state.facing,false);assert.equal(app.els.portraitGuidance.hidden,false);
    assert.equal(app.els.canvas.style.visibility,"hidden");
  }
  app.screen.orientation.angle=0;app.frame(700);assert.equal(app.state.facing,true);
});


test("permission error becomes visible after GPS recovery without another sensor event", () => {
  const app=sensorHarness();app.state.locationTimestamp=null;
  app.state.sensorError="Motion permission denied";app.frame();
  assert.equal(app.els.sensorWarning.hidden,true);
  app.state.locationTimestamp=Date.now();app.frame(200);
  assert.equal(app.els.sensorWarning.hidden,false);
  assert.equal(app.els.sensorWarning.textContent,"Motion permission denied");
});
