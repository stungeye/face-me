import test from "node:test";
import assert from "node:assert/strict";

import {
  FAMOUS_LOCATIONS,
  famousLocationById,
} from "../famous-locations.js";

test("famous locations have unique IDs and their curated exact coordinates", () => {
  const expectedCoordinates = {
    "kaaba-mecca": [21.4225, 39.8261667],
    "eiffel-tower": [48.8582972, 2.2944778],
    "great-pyramid-giza": [29.97915, 31.1342194],
    "statue-of-liberty": [40.6892092, -74.0444253],
    "taj-mahal": [27.175, 78.0419444],
    "christ-the-redeemer": [-22.9519156, -43.2104641],
    "sydney-opera-house": [-33.8570611, 151.2149],
    "cn-tower": [43.6427528, -79.3871472],
    "peace-tower": [45.4248889, -75.6998889],
    "peggys-point-lighthouse": [44.491825, -63.9186111],
    "pisew-falls": [55.1977778, -98.3966667],
    "port-of-churchill": [58.7744444, -94.1936111],
    "riding-mountain": [50.45, -100.19],
    "international-peace-garden": [49, -100.0594444],
    "human-rights-museum": [49.8906431, -97.1310931],
    "manitoba-legislature": [49.8844444, -97.1469444],
    "winnipeg-mint": [49.8525806, -97.0547389],
    "assiniboine-park": [49.8627778, -97.2444444],
  };

  assert.equal(FAMOUS_LOCATIONS.length, Object.keys(expectedCoordinates).length);
  assert.equal(new Set(FAMOUS_LOCATIONS.map(location => location.id)).size, FAMOUS_LOCATIONS.length);

  for (const location of FAMOUS_LOCATIONS) {
    assert.ok(location.name);
    assert.ok(location.country);
    assert.ok(location.group);
    assert.ok(Number.isFinite(location.lat));
    assert.ok(Number.isFinite(location.lon));
    assert.ok(location.lat >= -90 && location.lat <= 90);
    assert.ok(location.lon >= -180 && location.lon <= 180);
    assert.deepEqual([location.lat, location.lon], expectedCoordinates[location.id]);
  }
});

test("Mecca selects the Kaaba coordinates", () => {
  assert.deepEqual(famousLocationById("kaaba-mecca"), {
    id: "kaaba-mecca",
    group: "Worldwide",
    name: "Kaaba, Mecca",
    country: "Saudi Arabia",
    lat: 21.4225,
    lon: 39.8261667,
  });
});

test("an unknown famous location does not create a target", () => {
  assert.equal(famousLocationById("not-a-place"), null);
});
