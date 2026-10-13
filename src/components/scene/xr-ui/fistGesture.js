/*
* "Open hand -> fist" gesture, as a small pure state machine (no three.js / XR dependencies).
*
* Hand pose is described by `openness`: average over index/middle/ring/pinky of
*   distance(fingertip, wrist) / distance(knuckle, wrist)
* ~1.9 with the fingers extended, ~1.1 with a closed fist; independent of hand size.
*
* Flow (protects against accidental fists, e.g. right after moving an object):
* 1. ARM: hand open for at least ARM_MS while `canArm` (e.g. an object is selected) -> 'armed'
*    (the UI should show it, e.g. a red outline).
* 2. FIRE: a fist within FIRE_WINDOW_MS from the last armed instant -> 'fire' (once).
*    A slow close, or a fist while not armed, does nothing. After firing, the hand must open again.
* The hand must also be held "vertical" (palm perpendicular to the floor, like a karate chop):
* see isPalmVertical. A palm parallel to the floor never arms (outline stays orange).
* Thresholds are calibration knobs: tune them on the headset.
*/
export const OPEN_RATIO = 1.6;      // openness above this = open hand
export const FIST_RATIO = 1.25;     // openness below this = fist
export const ARM_MS = 400;          // open hand must be held this long to arm
export const FIRE_WINDOW_MS = 600;  // max time from armed (hand starts closing) to fist

// Palm orientation: |palmNormal.y| = 0 -> palm vertical (perpendicular to the floor), 1 -> palm horizontal.
// Hysteresis: becomes vertical within ~30° of vertical, stops being vertical beyond ~37°,
// so small wrist rotations while closing the fist do not cancel the gesture.
export const PALM_VERTICAL_ENTER = Math.sin((30 * Math.PI) / 180);
export const PALM_VERTICAL_EXIT = Math.sin((37 * Math.PI) / 180);

// palmNormalY: y component of the unit palm normal (world up = +Y); wasVertical: previous result
export function isPalmVertical(palmNormalY, wasVertical) {
    return Math.abs(palmNormalY) < (wasVertical ? PALM_VERTICAL_EXIT : PALM_VERTICAL_ENTER);
}

export function createFistGesture() {
    let openSince = null;    // when the hand became open (null if not open)
    let lastArmedAt = null;  // last instant the gesture was armed (null if disarmed)

    // Returns 'armed' | 'fire' | null for the current frame
    return function update(now, openness, canArm) {
        if (!canArm) {
            openSince = null;
            lastArmedAt = null;
            return null;
        }
        if (openness > OPEN_RATIO) {
            openSince ??= now;
            if (now - openSince >= ARM_MS) lastArmedAt = now;
            return lastArmedAt != null ? 'armed' : null;
        }
        openSince = null;
        if (lastArmedAt == null) return null;
        if (now - lastArmedAt > FIRE_WINDOW_MS) {
            lastArmedAt = null; // too slow: a natural closing, not a gesture
            return null;
        }
        if (openness < FIST_RATIO) {
            lastArmedAt = null; // fire once, then the hand must open again
            return 'fire';
        }
        return 'armed'; // closing in progress
    };
}
