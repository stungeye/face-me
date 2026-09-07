import assert from "node:assert/strict";
import test from "node:test";

import {
  ALIGNMENT_AXIS,
  angleDegBetween,
  deviceOrientationMatrix,
  directVectorEnu,
  earthToLocalFromRowMajorMatrix,
  earthToLocalFromSensorMatrix,
  inclinationDeg,
  normalize,
  parseCoordinates,
  parseCoordinatesFromSearch,
  rotationMatrixFromY,
  smoothDirection,
  targetDetails,
} from "../core.js";

const WINNIPEG = { lat: 49.895100, lon: -97.138400 };

const DOCUMENTED_TARGETS = {
  north: { lat: 54.391702, lon: -97.138400 },
  east: { lat: 49.686157, lon: -90.178222 },
  south: { lat: 45.398498, lon: -97.138400 },
  west: { lat: 49.686157, lon: -104.098578 },
  antipode: { lat: -49.895100, lon: 82.861600 },
};

function assertApproximately(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function assertVectorApproximately(actual, expected, epsilon = 1e-9) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assertApproximately(value, expected[index], epsilon));
}

test("plain coordinate parsing accepts supported forms and rejects invalid ranges", () => {
  assert.deepEqual(parseCoordinates("49.8951, -97.1384"), WINNIPEG);
  assert.deepEqual(parseCoordinates("(49.895100° -97.138400º)"), WINNIPEG);
  assert.deepEqual(parseCoordinates("90, 180"), { lat: 90, lon: 180 });
  assert.deepEqual(parseCoordinates("-90, -180"), { lat: -90, lon: -180 });

  assert.equal(parseCoordinates(""), null);
  assert.equal(parseCoordinates("not coordinates"), null);
  assert.equal(parseCoordinates("90.000001, 0"), null);
  assert.equal(parseCoordinates("0, 180.000001"), null);
});

test("shared-link parsing requires two explicitly present, nonblank coordinates", () => {
  for (const search of [
    "",
    "?other=value",
    "?lat=49.8951",
    "?lon=-97.1384",
    "?lat=&lon=-97.1384",
    "?lat=49.8951&lon=",
    "?lat=%20&lon=-97.1384",
    "?lat=49.8951&lon=%20",
  ]) {
    assert.equal(parseCoordinatesFromSearch(search), null, search);
  }
});

test("shared-link parsing rejects nonnumeric and out-of-range values", () => {
  for (const search of [
    "?lat=north&lon=-97.1384",
    "?lat=49.8951&lon=west",
    "?lat=NaN&lon=0",
    "?lat=Infinity&lon=0",
    "?lat=90.000001&lon=0",
    "?lat=-90.000001&lon=0",
    "?lat=0&lon=180.000001",
    "?lat=0&lon=-180.000001",
  ]) {
    assert.equal(parseCoordinatesFromSearch(search), null, search);
  }
});

test("shared-link parsing preserves valid links, boundaries, and explicit zeroes", () => {
  assert.deepEqual(
    parseCoordinatesFromSearch("?lat=49.895100&lon=-97.138400"),
    WINNIPEG,
  );
  assert.deepEqual(parseCoordinatesFromSearch("?lat=0&lon=0"), { lat: 0, lon: 0 });
  assert.deepEqual(parseCoordinatesFromSearch("?lat=90&lon=180"), { lat: 90, lon: 180 });
  assert.deepEqual(parseCoordinatesFromSearch("?lat=-90&lon=-180"), { lat: -90, lon: -180 });
  assert.deepEqual(
    parseCoordinatesFromSearch("?ignored=1&lat=49.8951&lon=-97.1384"),
    WINNIPEG,
  );
});

test("documented cardinal targets retain their physically verified ENU directions", () => {
  const expected = {
    north: [0, 0.9992300033072643, -0.03923519453965706],
    east: [0.9992302009153399, 0.0001298472085684243, -0.03922994670391683],
    south: [0, -0.9992304019298546, -0.0392250412249818],
    west: [-0.9992302009153399, 0.00012984720856825042, -0.039229946703916795],
  };

  for (const name of ["north", "east", "south", "west"]) {
    const direct = directVectorEnu(WINNIPEG, DOCUMENTED_TARGETS[name]);
    assertVectorApproximately(direct.vector, expected[name]);
    assertApproximately(Math.hypot(...direct.vector), 1);
    assert.ok(direct.chordDistanceM > 490_000 && direct.chordDistanceM < 510_000);
    assert.ok(inclinationDeg(direct.vector) < 0, `${name} should point below the horizon`);
  }
});

test("the documented antipode points essentially straight down through Earth", () => {
  const direct = directVectorEnu(WINNIPEG, DOCUMENTED_TARGETS.antipode);

  assert.ok(direct.vector[2] < -0.9999);
  assert.ok(inclinationDeg(direct.vector) < -89.5);
  assert.ok(direct.chordDistanceM > 12_700_000 && direct.chordDistanceM < 12_800_000);
});

test("target details derive one consistent vector, distance, surface distance, and tilt", () => {
  const target = targetDetails(WINNIPEG, DOCUMENTED_TARGETS.north);
  const direct = directVectorEnu(WINNIPEG, DOCUMENTED_TARGETS.north);

  assertVectorApproximately(target.vector, direct.vector);
  assert.equal(target.chordDistanceM, direct.chordDistanceM);
  assert.ok(target.surfaceDistanceM > 490_000 && target.surfaceDistanceM < 510_000);
  assert.equal(target.tiltDeg, inclinationDeg(target.vector));
});

test("orientation matrix helpers preserve their established layouts", () => {
  const rowMajorIdentity = deviceOrientationMatrix(0, 0, 0);
  assertVectorApproximately(rowMajorIdentity, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assertVectorApproximately(
    deviceOrientationMatrix(90, 0, 0),
    [0, -1, 0, 1, 0, 0, 0, 0, 1],
  );

  assert.deepEqual(
    earthToLocalFromRowMajorMatrix([1, 2, 3, 4, 5, 6, 7, 8, 9], [10, 20, 30]),
    [300, 360, 420],
  );
  assert.deepEqual(
    earthToLocalFromSensorMatrix(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      [1, 2, 3],
    ),
    [32, 38, 44],
  );
});

test("captured Pixel east targets point toward the top edge and below the screen", () => {
  const captures = [
    {
      earth: [0.999230, -0.000002, -0.039230],
      matrix: [0.192584, 0.981080, -0.019863, 0, -0.981264, 0.192660, 0.001964, 0, 0.005754, 0.019113, 0.999801, 0, 0, 0, 0, 1],
    },
    {
      earth: [0.987709, -0.000001, -0.156303],
      matrix: [0.069829, 0.997334, -0.021177, 0, -0.997548, 0.069913, 0.003239, 0, 0.004711, 0.020899, 0.999770, 0, 0, 0, 0, 1],
    },
  ];
  for (const { earth, matrix } of captures) {
    const local = earthToLocalFromSensorMatrix(matrix, earth);
    assert.ok(local[1] > 0.97, "east-facing phone must not place east behind it");
    assert.ok(local[2] < 0, "chord must still dip below the screen");
    assert.ok(angleDegBetween(local, ALIGNMENT_AXIS) < 12);
  }
});

test("sensor transforms known headings, pitch, and roll into phone coordinates", () => {
  // Basis vectors expressed in ENU: screen right, top edge, screen normal.
  // Include non-cardinal headings so inverse rotations cannot pass by symmetry.
  for (const heading of [0, 45, 90, 180, 270]) {
    for (const pitch of [0, -9, 35]) {
      for (const roll of [0, 25]) {
        const h = heading * Math.PI / 180;
        const p = pitch * Math.PI / 180;
        const r = roll * Math.PI / 180;
        const right = [Math.cos(h), -Math.sin(h), 0];
        const top = [Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)];
        const normal = [-Math.sin(h) * Math.sin(p), -Math.cos(h) * Math.sin(p), Math.cos(p)];
        const rolledRight = right.map((v, i) => v * Math.cos(r) - normal[i] * Math.sin(r));
        const rolledNormal = normal.map((v, i) => v * Math.cos(r) + right[i] * Math.sin(r));
        const matrix = [
          rolledRight[0], top[0], rolledNormal[0], 0,
          rolledRight[1], top[1], rolledNormal[1], 0,
          rolledRight[2], top[2], rolledNormal[2], 0,
          0, 0, 0, 1,
        ];
        assertVectorApproximately(earthToLocalFromSensorMatrix(matrix, top), [0, 1, 0]);
        assertVectorApproximately(earthToLocalFromSensorMatrix(matrix, rolledRight), [1, 0, 0]);
        assertVectorApproximately(earthToLocalFromSensorMatrix(matrix, rolledNormal), [0, 0, 1]);
        const belowTop = top.map((v, i) => v * Math.cos(0.15) - rolledNormal[i] * Math.sin(0.15));
        assertVectorApproximately(earthToLocalFromSensorMatrix(matrix, belowTop), [0, Math.cos(0.15), -Math.sin(0.15)]);
      }
    }
  }
});

test("the renderer rotation still maps +Y, the phone top edge, onto its target", () => {
  assert.deepEqual(ALIGNMENT_AXIS, [0, 1, 0]);

  for (const direction of [[1, 0, 0], [0, 0, 1], [-1, 0, 0]]) {
    const matrix = new Float32Array(9);
    rotationMatrixFromY(direction, matrix);
    assertVectorApproximately([matrix[3], matrix[4], matrix[5]], direction, 1e-6);
  }
});

test("normalization and time-based smoothing return finite unit directions", () => {
  assert.deepEqual(normalize([0, 0, 0]), [0, 0, 0]);
  assert.deepEqual(normalize([Number.NaN, 1, 0]), [0, 0, 0]);
  assertVectorApproximately(normalize([3, 4, 0]), [0.6, 0.8, 0]);
  assertVectorApproximately(smoothDirection(null, [0, 3, 0], 16.7), [0, 1, 0]);

  const current = [0, 1, 0];
  const target = [1, 0, 0];
  const shortFrame = smoothDirection(current, target, 8);
  const longFrame = smoothDirection(current, target, 40);

  assertApproximately(Math.hypot(...shortFrame), 1);
  assertApproximately(Math.hypot(...longFrame), 1);
  assert.ok(angleDegBetween(longFrame, target) < angleDegBetween(shortFrame, target));
  assert.deepEqual(current, [0, 1, 0]);
  assert.deepEqual(target, [1, 0, 0]);
});
