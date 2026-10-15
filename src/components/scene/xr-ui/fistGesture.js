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
* The hand must also be in the DELETE POSE (see isDeletePose): palm perpendicular to the floor, fingers
* pointing up and the BACK of the hand towards the user (palm facing away). Fingers down, a hand held
* sideways (karate chop) or a palm facing the user never arm (outline stays orange).
* Thresholds are calibration knobs: tune them on the headset.
*/
export const OPEN_RATIO = 1.6;      // openness above this = open hand
export const FIST_RATIO = 1.25;     // openness below this = fist
export const ARM_MS = 400;          // open hand must be held this long to arm
export const FIRE_WINDOW_MS = 600;  // max time from armed (hand starts closing) to fist

/*
* Delete pose, from two unit vectors of the hand (world up = +Y):
* - fingersUp: y of the direction wrist -> middle knuckle (1 = fingers straight up, -1 = down);
* - backToUser: cosine between the BACK-of-hand normal and the horizontal direction hand -> eyes
*   (1 = back of the hand squarely towards the user, 0 = hand sideways, -1 = palm towards the user).
* Fingers up already makes the palm perpendicular to the floor.
* Hysteresis: enters within ~35° (fingers) / ~45° (back), leaves beyond ~50° / ~65°, so the small
* wrist rotations of closing the fist do not cancel the gesture.
*/
const cos = (degrees) => Math.cos((degrees * Math.PI) / 180);
export const FINGERS_UP_ENTER = cos(35);
export const FINGERS_UP_EXIT = cos(50);
export const BACK_TO_USER_ENTER = cos(45);
export const BACK_TO_USER_EXIT = cos(65);

export function isDeletePose(fingersUp, backToUser, wasPose) {
    if (wasPose) return fingersUp > FINGERS_UP_EXIT && backToUser > BACK_TO_USER_EXIT;
    return fingersUp > FINGERS_UP_ENTER && backToUser > BACK_TO_USER_ENTER;
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
