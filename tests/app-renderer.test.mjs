import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { cross, normalize, rotationMatrixFromY } from "../core.js";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const start = source.indexOf("  function buildArrowGeometry(");
assert.ok(start >= 0);
const end = source.indexOf("\n  }", start) + 4;
const geometry = vm.runInNewContext(
  `${source.slice(start, end)}; buildArrowGeometry()`, { cross, normalize },
);
const shader = source.match(/this\.compile\(gl\.VERTEX_SHADER, `([\s\S]*?)`\)/)?.[1];
assert.ok(shader, "production vertex shader exists");
const position = shader.match(/gl_Position\s*=\s*vec4\(projected,\s*([^,]+),\s*([^\)]+)\)/);
assert.ok(position, "extract production clip z and w expressions");
const clip = new Function("p", `return [${position[1]}, ${position[2]}];`);

function rotate(p, m) {
  return [0, 1, 2].map(i => m[i] * p[0] + m[i + 3] * p[1] + m[i + 6] * p[2]);
}

for (const [view, direction] of [["toward", [0, 0, 1]], ["away", [0, 0, -1]]]) {
  test(`WebGL depth keeps the nearer arrow surface for the ${view} view`, () => {
    const rotation = new Float32Array(9);
    rotationMatrixFromY(direction, rotation);
    const vertices = [];
    for (let i = 0; i < geometry.vertices.length; i += 3) {
      const p = rotate(Array.from(geometry.vertices.slice(i, i + 3)), rotation);
      const [z, w] = clip({ x: p[0], y: p[1], z: p[2] });
      assert.ok(w > 0 && z >= -w && z <= w, "arrow stays inside depth clip range");
      vertices.push({ p, depth: (z / w + 1) / 2 });
    }
    // The tip and cap centers overlap at the center pixel when viewed along
    // the arrow axis. Use their actual rotated production geometry positions.
    const centers = vertices.filter(({ p }) => Math.hypot(p[0], p[1]) < 1e-6);
    assert.ok(centers.length >= 2);
    centers.sort((a, b) => b.p[2] - a.p[2]);
    const near = centers[0];
    const far = centers.at(-1);
    assert.ok(near.p[2] > far.p[2]);
    assert.ok(near.depth < far.depth, "positive z is nearer and must have smaller depth");
    // Model WebGL's default LESS test for both submission orders.
    for (const order of [[near, far], [far, near]]) {
      let depth = 1;
      let winner;
      for (const fragment of order) {
        if (fragment.depth < depth) {
          depth = fragment.depth;
          winner = fragment;
        }
      }
      assert.equal(winner, near);
    }
  });
}
