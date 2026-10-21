import { faceOffsets, openingLeaves, openingOperation, openingRects } from '../../../../plan/planModel.js';

/*
* 3D DOOR as data (pure, no three.js): the boxes a door (hinged, sliding, pocket) is made of, in the OPENING's local frame, so
* Openings3D.jsx only turns them into meshes and the rules can be checked in Node.
*
* Local frame: x = along the wall's drawn line (meters from the wall's start `a`), y = up from the floor,
* c = across, along the wall's normal (planModel.wallFrame; the faces are at faceOffsets inner / outer).
* A box: { min: [x, y, c], max: [x, y, c] }.
*
* doorParts(wall, opening, wallHeight) -> null | { frame: [box], leaves: [{ hinge: [x, c], openAngle, openShift, leaf: box, handle: [box] }] }
* - Doors with operation 'swing' | 'slide' | 'pocket' (windows come later): null otherwise (a 'passage' is
*   just the hole), or when the opening is clipped away (openingRects).
* - OPENING a leaf (renderer: progress p from 0 closed to 1 open): rotate by p x openAngle around the vertical
*   axis through `hinge`, and move by p x openShift along x. Swing: openAngle, openShift 0. Sliding: openShift,
*   openAngle 0: the leaf is MIRRORED out of the leaves' extent on the side it slides to, so leaves going the
*   same way stack without overlapping (they are on alternating tracks, so they can pass each other).
* - FRAME (part 'frame'): a lining on the three sides of the reveal (jambs + head, LINING thick, the wall's
*   full depth) and a casing (architrave) on both wall faces, CASING_WIDTH wide, CASING_DEPTH proud.
* - LEAVES (part 'leaf', planModel.openingLeaves: count, hinge side): inside the lining, LEAF_GAP clear,
*   LEAF_THICKNESS thick, flush with the face on the swing side ('in' = the inner face side, -normal as in
*   the 2D symbol: the face with the smaller c; 'out' = the larger c). hinge: the vertical axis at the
*   leaf's hinge edge on that face. openAngle: rotation (radians) in the x-c plane around the hinge that
*   opens the leaf towards the swing side: a point (dx, dc) from the hinge goes to
*   (dx cos a - dc sin a, dx sin a + dc cos a). The leaf and handle boxes are given CLOSED, in the same
*   frame (the renderer rotates them around the hinge).
* - SLIDE (on a face, the swing side, like the 2D symbol): the leaves hang in front of the casing, covering the
*   reveal and the casing, on two alternating tracks; a RAIL above them runs along the whole travel.
* - POCKET (into the wall): the leaves are on the wall's axis, two tracks side by side (each at most a quarter
*   of the wall's depth); on each side they slide to the jamb lining is SPLIT around the slot they run through
*   (the wall opens into its pocket); open, they are inside the wall but for POCKET_GRIP past the jamb.
* - Leaves of the same door meet with MEETING_GAP between them (the joint shows in 3D).
* - HANDLE (part 'handle'), on both faces of each leaf near its free edge, at HANDLE_HEIGHT: hinged = a rose,
*   a stem (perpendicular to the leaf) and the lever towards the hinge; sliding = a vertical bar on two stems;
*   pocket = a flat pull plate (nothing sticks out: the leaf goes into the wall).
* Calibration knobs (sizes in meters): tune by eye.
* ponytail: boxes only (no profiles, no panels); shapes and styles come with the customization step.
*/
export const LINING = 0.03;
export const CASING_WIDTH = 0.07;
export const CASING_DEPTH = 0.012;
export const LEAF_THICKNESS = 0.04;
export const LEAF_GAP = 0.004;
export const MEETING_GAP = 0.003; // between two leaves of the same door: a visible joint
const FLOOR_GAP = 0.008;
const HANDLE_HEIGHT = 1.0;
const HANDLE_INSET = 0.065;   // from the leaf's free edge to the handle's axis
const ROSE = [0.05, 0.05, 0.01];   // along, up, out from the leaf face
const LEVER = [0.12, 0.018, 0.018]; // along (towards the hinge), up, thick
const LEVER_OUT = 0.05;       // lever's distance from the leaf face
const STEM = 0.016;           // square section of the stem from the rose to the lever
// sliding doors
export const SLIDE_THICKNESS = 0.035; // a sliding leaf (pocket: at most a quarter of the wall's depth)
const SLIDE_GAP = 0.015;      // a face-sliding leaf off the casing
const TRACK_GAP = 0.004;      // between the two tracks of a sliding door
const RAIL_GAP = 0.005;       // rail above the leaves
const RAIL_HEIGHT = 0.05;
const BAR = 0.02;             // bar handle: section, length, distance from the leaf face
const BAR_LENGTH = 0.3;
const BAR_OUT = 0.035;
const PULL = [0.03, 0.14, 0.004]; // pocket door pull plate: wide, tall, proud
const POCKET_GRIP = 0.05;     // an open pocket leaf sticks out of the jamb by this much (visible, easy to click)

const box = (x0, x1, y0, y1, c0, c1) => ({ min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(c0, c1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(c0, c1)] });

export function doorParts(wall, opening, wallHeight) {
    const operation = openingOperation(opening);
    if (opening.type !== 'door' || !['swing', 'slide', 'pocket'].includes(operation)) return null;
    const rect = openingRects({ ...wall, openings: [opening] }, wallHeight)[0];
    if (rect == null) return null;
    const { from, to, top } = rect;
    const { inner, outer } = faceOffsets(wall);
    const c0 = Math.min(inner, outer), c1 = Math.max(inner, outer);
    const out = CASING_WIDTH - LINING; // casing beyond the reveal
    const isOut = opening.swing === 'out';
    const side = isOut ? 1 : -1;                     // the swing / slide side, along c
    const face = isOut ? c1 : c0;                    // the wall face on that side

    // which sides leaves slide to (pocket: no lining there, the wall is open into its pocket)
    const sides = openingLeaves(opening, from, to);
    const toStart = sides.some((leaf) => leaf.towardsStart), toEnd = sides.some((leaf) => !leaf.towardsStart);
    const pocketStart = operation === 'pocket' && toStart, pocketEnd = operation === 'pocket' && toEnd;

    const frame = [
        ...(pocketStart ? [] : [box(from, from + LINING, 0, top, c0, c1)]), // jambs
        ...(pocketEnd ? [] : [box(to - LINING, to, 0, top, c0, c1)]),
        box(from, to, top - LINING, top, c0, c1),                            // head
        ...[[c0 - CASING_DEPTH, c0], [c1, c1 + CASING_DEPTH]].flatMap(([a, b]) => [
            box(from - out, from + LINING, 0, top + out, a, b), // casing: sides and head, on each face
            box(to - LINING, to + out, 0, top + out, a, b),
            box(from - out, to + out, top - LINING, top + out, a, b)
        ])
    ];

    // the leaves' extent along x and their tracks across (c), per operation
    let lo, hi, y1, track;
    if (operation === 'swing') {
        [lo, hi] = [from + LINING + LEAF_GAP, to - LINING - LEAF_GAP];
        y1 = top - LINING - LEAF_GAP;
        track = () => [face, face - side * LEAF_THICKNESS];          // flush with the face, inside the reveal
    } else if (operation === 'slide') {
        // in front of the face (past the casing), covering the casing too; two alternating tracks
        [lo, hi] = [from - out, to + out];
        y1 = top + out;
        track = (i) => {
            const near = face + side * (CASING_DEPTH + SLIDE_GAP + (i % 2) * (SLIDE_THICKNESS + TRACK_GAP));
            return [near, near + side * SLIDE_THICKNESS];
        };
    } else {
        // pocket: on the wall's axis, two tracks side by side, into the wall on the pocket sides
        [lo, hi] = [pocketStart ? from : from + LINING + LEAF_GAP, pocketEnd ? to : to - LINING - LEAF_GAP];
        y1 = top - LINING - LEAF_GAP;
        const axis = (c0 + c1) / 2;
        const thickness = Math.min(SLIDE_THICKNESS, (c1 - c0) / 4);
        track = (i) => (i % 2 === 0 ? [axis - TRACK_GAP / 2 - thickness, axis - TRACK_GAP / 2] : [axis + TRACK_GAP / 2, axis + TRACK_GAP / 2 + thickness]);
    }
    const spans = openingLeaves(opening, lo, hi);
    const leaves = spans.map((full, index) => {
        // half the meeting gap off each edge that touches another leaf
        const span = { ...full, from: full.from + (index > 0 ? MEETING_GAP / 2 : 0), to: full.to - (index < spans.length - 1 ? MEETING_GAP / 2 : 0) };
        const leafC = track(index);
        const hingeX = span.towardsStart ? span.from : span.to;
        const freeX = span.towardsStart ? span.to : span.from;
        const toFree = Math.sign(freeX - hingeX);      // +1: the leaf runs towards +x from its fixed side
        const handleX = freeX - toFree * HANDLE_INSET;
        const faces = [Math.min(...leafC), Math.max(...leafC)];
        const handle = operation === 'swing' ? leverHandle(handleX, toFree, faces)
            : operation === 'slide' ? barHandle(handleX, faces) : pullHandle(handleX, faces);
        return {
            // pivot origin of the leaf (renderer): the hinge for a swing leaf, its fixed edge on the track otherwise
            hinge: [hingeX, operation === 'swing' ? face : leafC[0]],
            // swing: the free edge (dx = toFree * w) must end on the swing side (dc = side * w): sin a = side * toFree
            openAngle: operation === 'swing' ? (Math.PI / 2) * side * toFree : 0,
            // sliding: mirrored out of the leaves' extent on its side (stacked leaves never overlap)
            // pocket: short of the full travel, so the leaf stays POCKET_GRIP out of the jamb lining
            openShift: operation === 'swing' ? 0
                : (span.towardsStart ? 2 * lo - span.from - span.to : 2 * hi - span.from - span.to)
                    + (operation === 'pocket' ? (span.towardsStart ? 1 : -1) * (LINING + POCKET_GRIP) : 0),
            leaf: box(span.from, span.to, FLOOR_GAP, y1, leafC[0], leafC[1]),
            handle
        };
    });
    // pocket sides: a split jamb, the lining on both sides of the slot the leaves run through
    for (const [isStart, x0] of [[true, from], [false, to - LINING]]) {
        if (!(isStart ? pocketStart : pocketEnd)) continue;
        const slot = spans.flatMap((s, i) => (s.towardsStart === isStart ? track(i) : []));
        frame.push(box(x0, x0 + LINING, 0, top, c0, Math.min(...slot) - LEAF_GAP), box(x0, x0 + LINING, 0, top, Math.max(...slot) + LEAF_GAP, c1));
    }
    if (operation === 'slide') {
        // the rail above the leaves: from closed to open (as far as the open leaves reach), deep enough for both tracks
        const ends = leaves.flatMap(({ leaf, openShift }) => [leaf.min[0] + openShift, leaf.max[0] + openShift]);
        const railC = [face + side * CASING_DEPTH, face + side * (CASING_DEPTH + SLIDE_GAP + 2 * SLIDE_THICKNESS + TRACK_GAP + SLIDE_GAP)];
        frame.push(box(Math.min(lo, ...ends), Math.max(hi, ...ends), y1 + RAIL_GAP, Math.min(y1 + RAIL_GAP + RAIL_HEIGHT, wallHeight), railC[0], railC[1]));
    }
    return { frame, leaves };
}

// Hinged door: a rose, a stem and a lever (towards the hinge) on both faces of the leaf
function leverHandle(x, toFree, [inside, outside]) {
    return [[inside, -1], [outside, 1]].flatMap(([surface, s]) => [
        box(x - ROSE[0] / 2, x + ROSE[0] / 2, HANDLE_HEIGHT - ROSE[1] / 2, HANDLE_HEIGHT + ROSE[1] / 2, surface, surface + s * ROSE[2]),
        // stem: from the rose out to the lever's far side, on the handle's axis
        box(x - STEM / 2, x + STEM / 2, HANDLE_HEIGHT - STEM / 2, HANDLE_HEIGHT + STEM / 2, surface, surface + s * (LEVER_OUT + LEVER[2] / 2)),
        box(x, x - toFree * LEVER[0], HANDLE_HEIGHT - LEVER[1] / 2, HANDLE_HEIGHT + LEVER[1] / 2,
            surface + s * (LEVER_OUT - LEVER[2] / 2), surface + s * (LEVER_OUT + LEVER[2] / 2))
    ]);
}

// Sliding door on a face: a vertical bar on two short stems, on both faces of the leaf
function barHandle(x, [inside, outside]) {
    const [y0, y1] = [HANDLE_HEIGHT - BAR_LENGTH / 2, HANDLE_HEIGHT + BAR_LENGTH / 2];
    return [[inside, -1], [outside, 1]].flatMap(([surface, s]) => [
        box(x - STEM / 2, x + STEM / 2, y0 - BAR / 2, y1 + BAR / 2, surface + s * (BAR_OUT - BAR / 2), surface + s * (BAR_OUT + BAR / 2)),
        ...[y0, y1].map((y) => box(x - STEM / 2, x + STEM / 2, y - STEM / 2, y + STEM / 2, surface, surface + s * BAR_OUT))
    ]);
}

// Pocket door: a flat pull plate on both faces (nothing must stick out: the leaf goes into the wall)
function pullHandle(x, [inside, outside]) {
    return [[inside, -1], [outside, 1]].map(([surface, s]) => box(x - PULL[0] / 2, x + PULL[0] / 2,
        HANDLE_HEIGHT - PULL[1] / 2, HANDLE_HEIGHT + PULL[1] / 2, surface, surface + s * PULL[2]));
}
