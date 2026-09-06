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
    [8, 32, 56],
  );
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
