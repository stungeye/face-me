# Face Me — v1.2

An Android-first PWA that lets two people point directly toward one another using shared latitude/longitude coordinates.

## Core interaction

1. Face Me gets your current GPS latitude/longitude.
2. Copy your coordinates or a shareable URL containing them as `?lat=...&lon=...`.
3. Enter or paste the other person's coordinates, or choose a famous location. Opening one of the shared URLs fills the manual input automatically.
4. Tap **FACE ME**.
5. The screen becomes a black direction view with a 3D arrow.
6. The **top edge of the phone** is the pointing vector. Rotate and tilt the phone until the arrow aligns with that edge.
7. Double-tap the black direction screen to show/hide debug information.

The direction is the literal three-dimensional chord between the two WGS84 locations, not a surface-navigation bearing. Long-distance targets therefore point below the horizon and an antipodal target points almost straight down through the Earth.

## v1.2 changes

- Added a **User input / Famous location** choice for the target.
- Added grouped fixed-coordinate landmarks from around the world, Canada, Manitoba and Winnipeg, including the Kaaba in Mecca.
- Landmark targets show their exact stored latitude/longitude and use the same direct-through-Earth geometry as manually entered targets.

## v1.1 changes

- Removed the dedicated **Paste** button; use the keyboard/system paste action directly in the target field.
- **Their coordinates** now starts visually blank. Shared URLs still populate it automatically when `lat` and `lon` query parameters are present.
- Bumped the PWA cache/build version so the simplified UI replaces older cached builds after deployment.

## v1.0 improvements

- Renamed the app from **face it** to **Face Me** throughout the UI, manifest, cache and metadata.
- Reworked the setup screen with clearer location states, target validation, direct-distance preview and required phone-pointing instructions.
- Replaced the allocation-heavy Canvas arrow hot path with a compact **WebGL renderer** on supported devices. A Canvas fallback remains available.
- Caps arrow rendering resolution at 1.5× DPR. This is still crisp on high-density mobile screens without rendering the Pixel 8 Pro canvas at its full physical pixel count every frame.
- Sensor callbacks now update only the latest target vector; smoothing/rendering happens once per animation frame.
- Arrow smoothing is time-based instead of tied to sensor callback frequency.
- Alignment text is throttled to ~11 updates/sec and the debug panel to ~4 updates/sec rather than rebuilding DOM every frame.
- The animation loop now stops completely when arrow mode closes.
- Continuous GPS watches are tracked and cleared on exit, preventing duplicated watches after repeated testing.
- Adds a screen wake lock while Face Me mode is active when the browser supports it.
- Adds brief vibration feedback when the phone first enters the 5° **FACING** zone.
- Adds an explicit top-edge guide, target distance/tilt readout and a sensor-not-responding warning.
- Fullscreen/orientation-lock requests happen early in the user gesture for better Android reliability.
- PWA service worker remains network-first during active development so Netlify redeploys are less likely to be hidden by stale cache entries.

## Run / deploy

Geolocation and orientation sensors require a secure context. Use HTTPS for physical phone testing. Netlify works well: deploy the contents of this folder with `index.html` at the deploy root.

For desktop-only layout testing:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

The pure coordinate, geometry, orientation and lifecycle helpers have dependency-free tests that use Node's built-in test runner:

```bash
npm test
```

## Release checklist

- Update the cache name in `sw.js` and the query versions for every changed cached CSS or JavaScript file in `index.html`, `app.js` and `sw.js`.
- Run `npm test`, JavaScript syntax checks and a DOM ID/binding check.
- Verify that the target starts blank without URL parameters and that a valid shared `?lat=...&lon=...` link fills it.
- Enter and exit arrow mode repeatedly; confirm focus moves to the exit button and back to setup, and that animation, sensors, GPS watch and wake lock stop on exit.
- Load once online, switch the browser offline and verify that both the app root and a valid shared URL reload.
- Validate `manifest.webmanifest` and confirm both declared icons load.
- On the Pixel 8 Pro over HTTPS, verify the preferred sensor and fallbacks, then physically test north, east, south, west and the antipode.

## Android notes

- Target browser: Chrome on Android; primary test device: Pixel 8 Pro.
- Allow precise Location permission.
- If compass direction develops a consistent offset, move the phone in a figure-eight to recalibrate its magnetometer.
- Preferred sensor: `AbsoluteOrientationSensor` with `referenceFrame: "screen"`; fallback: `deviceorientationabsolute`, then `deviceorientation`.
- Browser absolute orientation may be magnetic-north referenced while the target geometry is geodetic/true-north referenced. Debug mode exposes the sensor path so a future magnetic-declination correction can be added if real-world testing shows a consistent bearing offset.

## Coordinate-link privacy

A copied link looks like:

```text
https://example.com/?lat=49.895100&lon=-97.138400
```

Face Me does not send coordinates to an app-specific backend/API, but coordinates in query parameters can appear in normal web-host/CDN request logs.
