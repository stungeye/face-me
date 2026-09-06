# Face Me — Codex Handoff

## Project goal

Face Me is an Android-first PWA for two people who want to physically point toward one another from anywhere on Earth.

Each person obtains their own GPS latitude/longitude, shares it manually (plain coordinates or a URL), enters the other person's coordinates, and then enters a full-screen arrow mode. The arrow represents the literal 3D vector from the current device to the target location.

This is intentionally **not** a surface-navigation compass. For distant targets the arrow dips below the horizon; an antipodal target points essentially straight down through Earth.

Current public deployment: https://face-me.netlify.app/
Primary test hardware/browser: Google Pixel 8 Pro, Chrome on Android.

## Current UX contract

- Product name: **Face Me** everywhere.
- Setup obtains the device GPS position.
- User can copy their coordinates.
- User can copy a share URL using `?lat=<latitude>&lon=<longitude>`.
- Opening such a URL pre-populates **Their coordinates** with the URL location.
- With no URL parameters, **Their coordinates starts blank**.
- There is deliberately **no Paste button**; normal keyboard/system paste is used.
- Main action label is **FACE ME**.
- Arrow mode has a black background.
- The **top edge of the phone** is currently the physical pointing vector. Do not silently change this to camera-forward without an explicit product decision.
- Double-tapping arrow mode toggles debug details; debug starts hidden.
- Exiting arrow mode must stop animation, sensor work, GPS watches, and wake lock cleanly.

## Geometry — preserve unless intentionally redesigning

The proven geometry lives in the pure `core.js` module:

1. Convert both geodetic WGS84 locations to ECEF.
2. Subtract target ECEF - current ECEF to obtain the literal chord through 3D space.
3. Convert that delta to local East/North/Up (ENU) at the current device location.
4. Normalize it and transform it into the device/screen frame using orientation telemetry.

Key functions:

- `geodeticToEcef()`
- `ecefDeltaToEnu()`
- `directVectorEnu()`
- `deviceOrientationMatrix()`
- `earthToLocalFromRowMajorMatrix()`
- `earthToLocalFromSensorMatrix()`

`ALIGNMENT_AXIS = [0, 1, 0]` means the top edge of the phone is the pointing axis.

The cardinal directions and antipode have been physically tested successfully on the Pixel 8 Pro. Avoid replacing this with a great-circle bearing implementation.

## Sensor strategy

Preferred/fallback order in the current implementation:

1. `AbsoluteOrientationSensor` with `referenceFrame: "screen"` when available.
2. `deviceorientationabsolute`.
3. `deviceorientation` fallback.

Be careful with coordinate-system/transposition changes. The working Android behavior is more important than making the math look prettier.

Known caveat: browser absolute orientation can be magnetic-north referenced while the target geometry is geodetic/true-north referenced. If future testing reveals a stable horizontal offset, investigate magnetic declination rather than changing the chord math.

## Arrow-mode performance work already done

The current v1.x renderer was optimized after the prototype became noticeably heavy on mobile:

- WebGL renderer when available; Canvas fallback remains.
- Rendering DPR capped at 1.5 rather than using full Pixel display DPR.
- Orientation events update state; animation-frame loop handles smoothing/rendering.
- Time-based direction smoothing.
- Alignment DOM updates are throttled.
- Debug DOM updates are throttled further.
- Animation frame is cancelled on exit.
- GPS watch is tracked and cleared on exit.
- Wake lock is released on exit.

Do not reintroduce per-sensor-event rendering, per-frame DOM rebuilding, uncapped high-DPI canvas rendering, or multiple concurrent geolocation watches.

## PWA / deployment

This is a build-free static application:

- `index.html`
- `styles.css`
- `app.js`
- `core.js`
- `lifecycle.js`
- `manifest.webmanifest`
- `sw.js`
- `icons/`

It can be deployed directly to Netlify with `index.html` at the deploy root.

Geolocation/orientation testing requires HTTPS on the phone.

The service worker is intentionally network-first during active development to make redeploys less sticky. When changing cache-sensitive files, update the cache/version identifiers consistently so installed PWAs do not stay on an old build.

## Useful physical test coordinates

Reference coordinate used during testing:

`49.895100, -97.138400` (Winnipeg reference)

Stable cardinal tests approximately hundreds of kilometres away:

- North: `54.391702, -97.138400`
- East: `49.686157, -90.178222`
- South: `45.398498, -97.138400`
- West: `49.686157, -104.098578`

Longer tests:

- About 2,000 km north: `67.881507, -97.138400`
- About 2,000 km east: `46.676144, -70.391278`
- About 2,000 km south: `31.908693, -97.138400`
- About 2,000 km west: `46.676144, -123.885522`
- Antipode: `-49.895100, 82.861600` — should point essentially straight down.

During physical testing, east, west, north, south, and antipode all behaved correctly. Farther test coordinates were noticeably more stable than very nearby targets because GPS error affects short-range bearings much more strongly.

## Product direction

Keep the app extremely simple. The core delight is: exchange coordinates -> press FACE ME -> physically find the other person through a direct Earth vector.

Useful future polish areas include visual/alignment feedback, sensor calibration/error handling, magnetic-declination compensation if needed, installation/PWA UX, accessibility, and simplifying the coordinate-sharing flow. Preserve the unusual direct-through-Earth behavior as the defining feature.
