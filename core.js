const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);

export const ALIGNMENT_AXIS = [0, 1, 0]; // top edge of the phone

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const normalize = v => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return Number.isFinite(n) && n > 1e-12 ? [v[0] / n, v[1] / n, v[2] / n] : [0, 0, 0];
};

export function geodeticToEcef(latDeg, lonDeg, altitude = 0) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const n = A / Math.sqrt(1 - E2 * sinLat * sinLat);
  return [
    (n + altitude) * cosLat * cosLon,
    (n + altitude) * cosLat * sinLon,
    (n * (1 - E2) + altitude) * sinLat,
  ];
}

export function ecefDeltaToEnu(delta, latDeg, lonDeg) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const [dx, dy, dz] = delta;
  return [
    -sinLon * dx + cosLon * dy,
    -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz,
    cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz,
  ];
}

export function directVectorEnu(from, to) {
  const a = geodeticToEcef(from.lat, from.lon);
  const b = geodeticToEcef(to.lat, to.lon);
  const delta = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const enu = ecefDeltaToEnu(delta, from.lat, from.lon);
  return { vector: normalize(enu), enu, chordDistanceM: Math.hypot(...delta) };
}

export function surfaceDistanceM(from, to) {
  const phi1 = from.lat * DEG;
  const phi2 = to.lat * DEG;
  const dPhi = phi2 - phi1;
  const dLambda = (to.lon - from.lon) * DEG;
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function bearingDeg(v) {
  return (Math.atan2(v[0], v[1]) * RAD + 360) % 360;
}

export function inclinationDeg(v) {
  const [east, north, up] = normalize(v);
  return Math.atan2(up, Math.hypot(east, north)) * RAD;
}

export function angleDegBetween(a, b) {
  return Math.acos(clamp(dot(normalize(a), normalize(b)), -1, 1)) * RAD;
}

function validCoordinates(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

export function parseCoordinates(text) {
  if (!text) return null;
  const cleaned = String(text).trim().replace(/[()\[\]]/g, " ").replace(/[°º]/g, " ");
  const matches = cleaned.match(/[-+]?\d+(?:\.\d+)?/g);
  if (!matches || matches.length < 2) return null;
  return validCoordinates(Number(matches[0]), Number(matches[1]));
}

export function parseCoordinatesFromSearch(search) {
  const params = new URLSearchParams(search);
  if (!params.has("lat") || !params.has("lon")) return null;

  const latitude = params.get("lat")?.trim();
  const longitude = params.get("lon")?.trim();
  if (!latitude || !longitude) return null;

  return validCoordinates(Number(latitude), Number(longitude));
}

export function formatCoordinates({ lat, lon }, digits = 6) {
  return `${lat.toFixed(digits)}, ${lon.toFixed(digits)}`;
}

export function formatDistance(m) {
  if (!Number.isFinite(m)) return "—";
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 100000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000).toLocaleString()} km`;
}

export function formatTilt(deg) {
  if (!Number.isFinite(deg)) return "—";
  const abs = Math.abs(deg);
  if (abs < 0.3) return "near horizon";
  return `${abs.toFixed(abs < 10 ? 1 : 0)}° ${deg < 0 ? "down" : "up"}`;
}

export function fmt(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

export function deviceOrientationMatrix(alphaDeg, betaDeg, gammaDeg) {
  const a = alphaDeg * DEG;
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  const cA = Math.cos(a), sA = Math.sin(a);
  const cB = Math.cos(b), sB = Math.sin(b);
  const cG = Math.cos(g), sG = Math.sin(g);
  return [
    cA * cG - sA * sB * sG, -cB * sA, cG * sA * sB + cA * sG,
    cG * sA + cA * sB * sG, cA * cB, sA * sG - cA * cG * sB,
    -cB * sG, sB, cB * cG,
  ];
}

export function earthToLocalFromRowMajorMatrix(matrix, earth) {
  const [x, y, z] = earth;
  return [
    matrix[0] * x + matrix[3] * y + matrix[6] * z,
    matrix[1] * x + matrix[4] * y + matrix[7] * z,
    matrix[2] * x + matrix[5] * y + matrix[8] * z,
  ];
}

export function earthToLocalFromSensorMatrix(matrix, earth) {
  const [x, y, z] = earth;
  // populateMatrix's column-major rotation is applied directly here.
  // Transposing it again reverses east/west in the Pixel sensor captures.
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z,
    matrix[1] * x + matrix[5] * y + matrix[9] * z,
    matrix[2] * x + matrix[6] * y + matrix[10] * z,
  ];
}

export function smoothDirection(current, target, dtMs, tauMs = 78) {
  if (!current || Math.hypot(...current) < 1e-9) return normalize(target);
  const amount = clamp(1 - Math.exp(-dtMs / tauMs), 0.02, 0.72);
  return normalize([
    current[0] + (target[0] - current[0]) * amount,
    current[1] + (target[1] - current[1]) * amount,
    current[2] + (target[2] - current[2]) * amount,
  ]);
}

export function rotationMatrixFromY(direction, out) {
  const to = normalize(direction);
  const c = clamp(to[1], -1, 1);
  if (c > 0.999999) {
    out.set([1,0,0, 0,1,0, 0,0,1]);
    return out;
  }
  if (c < -0.999999) {
    out.set([1,0,0, 0,-1,0, 0,0,-1]);
    return out;
  }

  // Quaternion rotating +Y to `to`.
  const v = cross([0, 1, 0], to);
  let qx = v[0], qy = v[1], qz = v[2], qw = 1 + c;
  const qn = Math.hypot(qx, qy, qz, qw);
  qx /= qn; qy /= qn; qz /= qn; qw /= qn;

  const xx = qx * qx, yy = qy * qy, zz = qz * qz;
  const xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;

  // Column-major mat3 for WebGL.
  out[0] = 1 - 2 * (yy + zz);
  out[1] = 2 * (xy + wz);
  out[2] = 2 * (xz - wy);
  out[3] = 2 * (xy - wz);
  out[4] = 1 - 2 * (xx + zz);
  out[5] = 2 * (yz + wx);
  out[6] = 2 * (xz + wy);
  out[7] = 2 * (yz - wx);
  out[8] = 1 - 2 * (xx + yy);
  return out;
}

// Initial great-circle direction on a spherical Earth, tangent to the horizon.
// Coincident and antipodal points have no unique initial bearing.
export function surfaceVectorEnu(from, to) {
  const phi1 = from.lat * DEG;
  const phi2 = to.lat * DEG;
  const delta = (to.lon - from.lon) * DEG;
  const east = Math.cos(phi2) * Math.sin(delta);
  const north = Math.cos(phi1) * Math.sin(phi2)
    - Math.sin(phi1) * Math.cos(phi2) * Math.cos(delta);
  return Math.hypot(east, north) > 1e-12 ? normalize([east, north, 0]) : null;
}

export function targetDetails(from, to, mode = "direct") {
  const direct = directVectorEnu(from, to);
  const vector = mode === "surface" ? surfaceVectorEnu(from, to) : direct.vector;
  return {
    vector,
    chordDistanceM: direct.chordDistanceM,
    surfaceDistanceM: surfaceDistanceM(from, to),
    tiltDeg: vector ? inclinationDeg(vector) : NaN,
  };
}
