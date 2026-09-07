# Face Me — v1.7

An Android-first PWA that lets two people point directly toward one another using shared latitude/longitude coordinates.

## Core interaction

1. Face Me gets your current GPS latitude/longitude.
2. Copy your coordinates or a shareable URL containing them as `?lat=...&lon=...`.
3. Enter or paste the other person's coordinates, or choose a famous location. Opening one of the shared URLs fills the manual input automatically.
4. Choose **Surface** (the default) or **Through Earth**, then tap **FACE ME**.
5. The screen becomes a black direction view with a 3D arrow.
6. The **top edge of the phone** is the pointing vector. Rotate and tilt the phone until the arrow aligns with that edge.
The top-right tilt bubble shows the remaining elevation adjustment independently of heading: raise the top edge for **Tilt up**, lower it for **Tilt down**, and bring the bubble to the center. **Matched** means tilt is within 3°, not that the heading is aligned. The bubble hides while waiting for sensor readings.

7. Double-tap the black direction screen to show/hide debug information.
8. During a pointing check, use **Copy checking details** in debug mode and paste the report back with the short observation fields completed.

Surface mode follows the initial great-circle bearing on a spherical Earth, with a horizontal pointing vector and surface distance. It updates as your GPS position changes. It is a heading, not road or trail routing. Coincident locations and exact antipodes have no unique surface direction.

Through Earth mode preserves the literal three-dimensional chord between the two WGS84 locations. Long-distance targets point below the horizon and an antipodal target points almost straight down through the Earth. Both modes use the same phone orientation and top-edge alignment.

## v1.3 changes

- Added exact-axis 500 km, 2,000 km and antipode targets under **Pointing checks**. These are cardinal only from the test reference at `49.856352, -97.261698`; setup and debug mode also report the live expected true heading from the current GPS fix.
- Added a **Copy checking details** button to debug mode. Its report captures the target geometry, current GPS accuracy, raw and smoothed phone-frame vectors, alignment error, sensor path and orientation matrix, screen orientation, renderer and browser identity.
- Added observation placeholders so a physical compass reading and what the arrow did can travel with the sensor snapshot.

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

The app checks for a new service worker on launch, on returning to the app, on reconnecting, and every five minutes while visible. New releases activate automatically, remove old Face Me caches, and reload setup while preserving the entered target. In arrow mode, reload waits until exit. Offline use retains the last cached app. Netlify's `_headers` file forces HTTP revalidation, and worker installation bypasses the HTTP cache.

For the first deployment of this updater, an already-open older app may need one normal close/reopen or reload to pick up the new client code. Clearing site data is unnecessary.

- Update the cache name in `sw.js` and the query versions for every changed cached CSS or JavaScript file in `index.html`, `app.js` and `sw.js`.
- Run `npm test`, JavaScript syntax checks and a DOM ID/binding check.
- Verify that the target starts blank without URL parameters and that a valid shared `?lat=...&lon=...` link fills it.
- Enter and exit arrow mode repeatedly; confirm focus moves to the exit button and back to setup, and that animation, sensors, GPS watch and wake lock stop on exit.
- Load once online, switch the browser offline and verify that both the app root and a valid shared URL reload.
- With the previous release open, deploy the next version and return to the app; verify automatic refresh preserves the target. Repeat in arrow mode and verify refresh waits until exit.
- Validate `manifest.webmanifest` and confirm both declared icons load.
- On the Pixel 8 Pro over HTTPS, verify the preferred sensor and fallbacks, then physically test north, east, south, west and the antipode.

## Android notes

- Target browser: Chrome on Android; primary test device: Pixel 8 Pro.
- Allow precise Location permission.
- If compass direction develops a consistent offset, move the phone in a figure-eight to recalibrate its magnetometer.
- Preferred sensor: `AbsoluteOrientationSensor` with `referenceFrame: "screen"`; fallback: `deviceorientationabsolute`, then `deviceorientation`.
- Browser absolute orientation may be magnetic-north referenced while the target geometry is geodetic/true-north referenced. Debug mode exposes the sensor path so a future magnetic-declination correction can be added if real-world testing shows a consistent bearing offset.

## Tabletop pointing check

1. Remove magnetic cases or accessories and use a wood or plastic table away from laptops, speakers, steel legs and power cables. Calibrate the phone with a figure-eight motion.
2. In a compass app that clearly labels its north reference, select **true north**, place the phone flat and screen-up, then rotate the top edge to the test target's nominal heading: north `000°`, east `090°`, south `180°` or west `270°`.
3. In Face Me, refresh GPS and select a target under **Pointing checks**. These targets are exact axes from `49.856352, -97.261698`; elsewhere, note the live **True heading** in the setup preview rather than using the nominal heading. Switch to the compass, set that heading, then return to Face Me without rotating the phone.
4. Tap **FACE ME**, double-tap the arrow screen, then tap **Copy checking details**. Paste the report and complete its observation fields.
5. Select **Through Earth** for these original chord checks. Repeat each orientation at least three times after deliberately rotating away and returning. Test the 500 km set first. Flat, those targets are only about `2.25°` below the horizon. The 2,000 km set is about `9°` down and is useful for testing tilt separately. The antipode should point almost straight down.

A second compass app on the same phone is a repeatability reference, not independent ground truth: both apps ultimately use the same physical sensors. A surveyed sightline, map-derived building edge or separate baseplate compass gives a stronger cross-check.

## Coordinate-link privacy

A copied link looks like:

```text
https://example.com/?lat=49.895100&lon=-97.138400
```

Face Me does not send coordinates to an app-specific backend/API, but coordinates in query parameters can appear in normal web-host/CDN request logs.
