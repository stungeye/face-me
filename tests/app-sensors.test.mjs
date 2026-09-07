import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as core from "../core.js";

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
  const element = () => ({
    hidden: true, textContent: "", dataset: {},
    style: { setProperty() {} }, setAttribute() {},
    classList: { remove() {}, toggle() {} },
  });
  const els = Object.fromEntries([
    "sensorWarning", "alignmentText", "alignment", "faceStage", "tiltLevel", "tiltCue", "alignmentStatus",
  ].map(name => [name, element()]));
  const state = {
    targetUnitEnu: [0, 1, 0], rawLocalDirection: null, sensorAbsolute: false,
    displayDirection: [0, 1, 0], localUp: null, displayTilt: null,
    lastSensorReadingAt: 0, lastFrameAt: 0, lastUiAt: 0, lastVibrateAt: 0,
  };
  const context = vm.createContext({
    ...core, state, els, performance: { now: () => now },
    faceSession: { active: true, isCurrent: session => session === 1 },
    renderer: { render() {} }, requestAnimationFrame: () => 1,
    updateDebugPanel() {}, navigator: {},
    ALIGNMENT_STATUS_TEXT: { acquiring: "Acquiring direction.", off: "Off", close: "Close", facing: "Facing target." },
  });
  const names = ["setRawLocalDirection", "updateDirectionFromSensorState", "onDeviceOrientation", "setAccessibleAlignmentStatus", "updateAlignmentUi", "frame"];
  vm.runInContext(names.map(functionSource).join("\n"), context);
  return {
    state, els,
    reading(event, source = "deviceorientation") { context.onDeviceOrientation(event, source, 1); },
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
