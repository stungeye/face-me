# Device validation

Automated browser mocks verify contracts and lifecycle behavior. They do not certify physical compass accuracy or reproduce OS permission prompts. Record the installed OS/browser versions and Face Me release for each run.

## Initial device matrix

| Device | Browser / launch mode | Physical validation |
| --- | --- | --- |
| Pixel 8 Pro | Chrome tab and installed PWA | Pending for this release |
| Pixel 8 Pro | Firefox tab | Pending for this release |
| Pixel 7 Pro | Chrome and Firefox tabs | Pending for this release |
| iPhone 15 Pro | Safari tab and Home Screen | Pending for this release |

Other browsers use capability detection, but are not considered physically validated by this matrix.

## Location and permission checks

1. Open the HTTPS app with fresh site permissions. Record each prompt, the time to first fix, reported accuracy, and whether a better fix follows. Repeat indoors and outdoors.
2. Deny location, then allow it through browser/OS settings and use Refresh. Verify the message distinguishes denial from timeout or unavailability and recovery requires no reinstall.
3. Where available, test approximate and precise OS location permissions. High accuracy is a request; assess the returned accuracy rather than the wording of a prompt.
4. Try repeated Refresh taps and entering/exiting arrow mode during acquisition. Verify old requests cannot replace the current session's state.
5. Revoke location or disable location services during arrow mode. Verify the app exposes loss of location rather than silently presenting stale data as fresh.
6. On iPhone, test motion/orientation permission denial and a subsequent retry separately from GPS permission. Record any browser or OS error verbatim.

## Pointing repeatability

Use the README tabletop procedure, distant cardinal targets, and an independent reference where possible. A second app on the same phone shares its physical sensors and is not independent ground truth. Nominal cardinal test labels apply only at their documented origin; elsewhere use the calculated true heading.

For each device/browser, test Surface and Through Earth, north/east/south/west, and the Through Earth antipode. For each target, perform five fresh launches with different starting headings. Keep the target fixed, then point the physical top edge along the same reference direction. Record startup source changes, settling time, final angular error, GPS accuracy, north reference, and any persistent drift. Repeat with tilt and roll, and check landscape if rotation cannot be locked. Never interpret antipodal Surface mode as having a unique heading.

Collect a checking report after settling and another during any inconsistency. Remove magnetic accessories and move away from metal/electronics, then repeat to distinguish environmental effects. Compare magnetic and true north explicitly; do not change geometry to compensate for an unexplained offset.

Agree on acceptable angular error and settling time from the measured baseline before calling new devices physically validated. A passing software test suite alone does not meet that criterion.

## Session and PWA checks

- Repeat entry/exit at least ten times. Confirm one active GPS watch and sensor source, no duplicate animation, and complete resource cleanup after exit.
- Background the app, lock/unlock the phone, and return. Verify reacquisition uses fresh readings and no old alignment is briefly shown.
- Repeat in supported Home Screen/PWA modes. Lack of native fullscreen or orientation lock must not prevent pointing.
- Load online, then reload offline at both the root URL and a coordinate share URL. Verify all newly introduced service modules are cached.
- Upgrade from the previous release with setup open and with arrow mode active. Confirm the release label updates and the existing deferred-update behavior is preserved.

Reports are copied by the user; do not automatically upload location or sensor telemetry.
