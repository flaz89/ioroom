import { faceOffsets, openingLeaves, openingOperation, openingRects } from '../../../../plan/planModel.js';
import { STEEL_ID, WHITE_ID, paintId } from '../../../../materials/finishes.js';

/*
* 3D DOORS AND WINDOWS as data (pure, no three.js): the boxes an opening (hinged, sliding, pocket; windows also
* fixed) is made of, in the OPENING's local frame, so Openings3D.jsx only turns them into meshes and the rules
* can be checked in Node.
*
* Local frame: x = along the wall's drawn line (meters from the wall's start `a`), y = up from the floor,
* c = across, along the wall's normal (planModel.wallFrame; the faces are at faceOffsets inner / outer).
* A box: { min: [x, y, c], max: [x, y, c] }.
*
* openingParts(wall, opening, wallHeight, partStyles = {}) -> null | { frame: [box],
*     leaves: [{ hinge: [x, c], openAngle, openShift, leaf: box, sash?: [box], glass?: box, handle: [box] }] }
* - Doors 'swing' | 'flush' | 'slide' | 'pocket', windows 'standard' (one FIXED sash on the wall's axis) | 'swing' | 'slide': null
*   otherwise (a door 'passage' and a window 'hole' are just the hole), or when the opening is clipped away
*   (openingRects).
* - OPENING a leaf (renderer: progress p from 0 closed to 1 open): rotate by p x openAngle around the vertical
*   axis through `hinge`, and move by p x openShift along x. Swing: openAngle, openShift 0. Sliding: openShift,
*   openAngle 0: the leaf is MIRRORED out of the leaves' extent on the side it slides to, so leaves going the
*   same way stack without overlapping (they are on alternating tracks, so they can pass each other).
*   A fixed window sash: both 0.
* - FRAME (part 'frame'): a lining around the reveal (LINING thick, the wall's full depth: jambs + head, and
*   for a window the bottom too) and a casing (architrave) CASING_WIDTH wide, CASING_DEPTH proud: doors on
*   both wall faces, windows on the inner face only (the room's side), standing on an inner SILL board that
*   juts SILL_IN into the room; outside, a window has an outer sill jutting SILL_OUT.
* - LEAVES (planModel.openingLeaves: count, hinge side): inside the lining, LEAF_GAP clear, flush with the face
*   on the swing side ('in' = the inner face side, -normal as in the 2D symbol: the face with the smaller c;
*   'out' = the larger c). hinge: the vertical axis at the leaf's hinge edge on that face. openAngle: rotation
*   (radians) in the x-c plane around the hinge that opens the leaf towards the swing side: a point (dx, dc)
*   from the hinge goes to (dx cos a - dc sin a, dx sin a + dc cos a). All boxes are given CLOSED, in the same
*   frame (the renderer rotates them around the hinge). `leaf` is the leaf's whole box: a door's leaf (part
*   'leaf'); a window draws instead its `sash` (part 'leaf': a frame SASH wide around the pane) and `glass`
*   (part 'glass', GLASS thick, in the middle of the sash's depth).
* - FLUSH DOOR ('flush', "porta a raso"): a hinged door (everything above for 'swing' holds) built to vanish
*   into the wall: NO casing, and the leaf covers the lining on its swing face (only LEAF_GAP shows around it,
*   flush with the wall face); the lining (jambs + head) runs behind the leaf, from its back to the other face,
*   where it is flush with the wall and acts as the stop.
* - SLIDE DOOR (on a face, the swing side, like the 2D symbol): the leaves hang in front of the casing, covering
*   the reveal and the casing, on two alternating tracks; a RAIL above them runs from closed to fully open.
* - SLIDE WINDOW (the classic one): inside the lining, EACH leaf on its own track across the reveal (centered on
*   the wall's axis, within WINDOW_TRACKS_DEPTH of its depth); the leaf at the hinge end ('start' default |
*   'end': the panel's "Slides to") is FIXED (outermost track, no handle), opening slides every other leaf onto
*   its place: with 4 leaves, 3 move on 3 tracks and all end over the 4th.
* - POCKET (into the wall, doors only, at most 2 leaves: planModel.openingMaxLeaves): the leaves share ONE track
*   on the wall's axis (at most a quarter of the wall's depth; 2 leaves part, one to each side); on each side they slide to the jamb lining is SPLIT around the slot they run through
*   (the wall opens into its pocket); open, they are inside the wall but for POCKET_GRIP past the jamb.
* - Leaves of the same opening meet with MEETING_GAP between them (the joint shows in 3D).
* - HANDLE (part 'handle') near each leaf's free edge: doors on both faces at HANDLE_HEIGHT, windows on the
*   room's side only at mid height. Its STYLE (store partStyles '<opening>:handle', one for both faces; see
*   HANDLE_STYLES: which styles each kind of opening offers, the first being its default) is one of:
*   'lever' = a rose, a stem (perpendicular to the leaf) and the lever (doors: towards the hinge; windows: down);
*   'knob' = a rose, a short stem and a knob; 'bar' = a vertical bar on two stems; 'recessed' = a flat pull
*   plate almost flush with the leaf (nothing sticks out: pocket doors, sliding windows, flush doors); 'none'.
*   A fixed sash / leaf never has one.
* Calibration knobs (sizes in meters): tune by eye.
* ponytail: boxes only (no profiles, no panels); shapes and styles come with the customization step.
*/
export const LINING = 0.03;
export const CASING_WIDTH = 0.07;
export const CASING_DEPTH = 0.012;
export const LEAF_THICKNESS = 0.04;
export const LEAF_GAP = 0.004;
export const MEETING_GAP = 0.003; // between two leaves of the same opening: a visible joint
const FLOOR_GAP = 0.008;
const HANDLE_HEIGHT = 1.0;
const HANDLE_INSET = 0.065;   // from the leaf's free edge to the handle's axis
const ROSE = [0.05, 0.05, 0.01];   // along, up, out from the leaf face
const LEVER = [0.12, 0.018, 0.018]; // length (towards the hinge / down), section, thick
const LEVER_OUT = 0.05;       // lever's distance from the leaf face
const STEM = 0.016;           // square section of the stem from the rose to the lever
const KNOB = [0.05, 0.05, 0.035]; // knob: along, up, thick
const KNOB_OUT = 0.05;        // knob's middle: distance from the leaf face
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
// windows
export const SASH = 0.055;          // width of a sash's frame around the glass
export const SASH_DEPTH = 0.068;    // a hinged / fixed sash (at most half the wall's depth)
export const GLASS = 0.008;
export const SILL_IN = 0.03;        // inner sill board: how far it juts into the room
export const SILL_OUT = 0.04;       // outer sill: how far it juts outside, and past the reveal on each side
const WINDOW_PULL = [0.025, 0.1, 0.004];
const WINDOW_TRACKS_DEPTH = 0.8;    // share of the wall's depth a sliding window's tracks may take

/*
* MATERIALS of an opening's parts (store `surfaces`, synced and undoable like the walls' faces):
* - '<opening>' = the whole STRUCTURE: frame (lining, casing, sills, rail) and leaves (a window's sashes);
* - '<opening>:frame' | ':leaf' | ':handle' = a part's own material, which wins.
* A part reads its own, then (frame and leaf only: the handle keeps its finish) the structure's, then its
* DEFAULT finish (materials/finishes.js: paint / fixed finishes). The glass is fixed.
*/
export const DEFAULT_PART_MATERIALS = { frame: WHITE_ID, leaf: paintId('#e6e0d4'), handle: STEEL_ID };
export const partMaterialId = (surfaces, openingId, part) =>
    surfaces[`${openingId}:${part}`] ?? (part === 'handle' ? null : surfaces[openingId]) ?? DEFAULT_PART_MATERIALS[part];

const box = (x0, x1, y0, y1, c0, c1) => ({ min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(c0, c1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(c0, c1)] });
const OPERATIONS = { door: ['swing', 'flush', 'slide', 'pocket'], window: ['standard', 'swing', 'slide'] };

/*
* HANDLE STYLES offered by each kind of opening ('<type>:<operation>'), the first = its DEFAULT. Only what
* makes sense there: nothing sticking out of a pocket door (it slides into the wall), no lever on a door
* sliding on a face, a fixed window has none. Kinds missing here have no handle (passage, hole).
*/
export const HANDLE_STYLES = {
    'door:swing': ['lever', 'knob', 'bar', 'recessed', 'none'],
    'door:flush': ['recessed', 'lever', 'knob', 'bar', 'none'],
    'door:slide': ['bar', 'recessed', 'none'],
    'door:pocket': ['recessed', 'none'],
    'window:swing': ['lever', 'none'],
    'window:slide': ['recessed', 'none'],
    'window:standard': ['none']
};
// The handle styles an opening offers ([] = none at all)
export const handleStyles = (opening) => HANDLE_STYLES[`${opening.type}:${openingOperation(opening)}`] ?? [];
// The handle style an opening shows: the stored one (store partStyles) when this kind offers it, else the default
export function handleStyle(partStyles, opening) {
    const styles = handleStyles(opening);
    const stored = partStyles[`${opening.id}:handle`];
    return styles.includes(stored) ? stored : styles[0] ?? 'none';
}

export function openingParts(wall, opening, wallHeight, partStyles = {}) {
    const kind = openingOperation(opening);
    if (!OPERATIONS[opening.type]?.includes(kind)) return null;
    // a flush door is a hinged one with its own frame and leaf extent: 'swing' from here on, but isFlush
    const isFlush = kind === 'flush';
    const operation = isFlush ? 'swing' : kind;
    const isWindow = opening.type === 'window';
    const rect = openingRects({ ...wall, openings: [opening] }, wallHeight)[0];
    if (rect == null) return null;
    const { from, to, bottom, top } = rect;
    const { inner, outer } = faceOffsets(wall);
    const c0 = Math.min(inner, outer), c1 = Math.max(inner, outer);
    const roomward = Math.sign(inner - outer);       // along c, from the wall into the room (the inner side)
    const out = CASING_WIDTH - LINING; // casing beyond the reveal
    const isOut = opening.swing === 'out';
    const side = isOut ? 1 : -1;                     // the swing / slide side, along c
    const face = isOut ? c1 : c0;                    // the wall face on that side
    const axis = (c0 + c1) / 2;

    // which sides leaves slide to (pocket: no lining there, the wall is open into its pocket)
    const sides = openingLeaves(opening, from, to);
    // sliding window: the leaf at the hinge end ('start' default | 'end') stays, the others slide over it
    const isSlidingWindow = isWindow && operation === 'slide';
    const fixedAtStart = opening.hinge !== 'end';
    const windowRank = (i) => (fixedAtStart ? i : sides.length - 1 - i);
    const toStart = sides.some((leaf) => leaf.towardsStart), toEnd = sides.some((leaf) => !leaf.towardsStart);
    const pocketStart = operation === 'pocket' && toStart, pocketEnd = operation === 'pocket' && toEnd;

    // a window's lining also runs under it (sill): its casing starts above that
    const sill = isWindow ? bottom + LINING : bottom;
    // the lining's depth: the whole wall, but a flush door's stops behind its leaf (the leaf covers it there)
    const [l0, l1] = isFlush ? (isOut ? [c0, c1 - LEAF_THICKNESS] : [c0 + LEAF_THICKNESS, c1]) : [c0, c1];
    const frame = [
        ...(pocketStart ? [] : [box(from, from + LINING, bottom, top, l0, l1)]), // jambs
        ...(pocketEnd ? [] : [box(to - LINING, to, bottom, top, l0, l1)]),
        box(from, to, top - LINING, top, l0, l1),                                  // head
        // casing: sides and head, on each face (a window: the inner face only; a flush door: none)
        ...(isWindow ? [inner] : isFlush ? [] : [c0, c1]).map((f) => [f, f + Math.sign(f - axis) * CASING_DEPTH]).flatMap(([a, b]) => [
            box(from - out, from + LINING, sill, top + out, a, b),
            box(to - LINING, to + out, sill, top + out, a, b),
            box(from - out, to + out, top - LINING, top + out, a, b)
        ]),
        ...(isWindow ? [
            box(from, to, bottom, sill, c0, c1),                                       // bottom lining
            box(from - out, to + out, bottom, sill, inner, inner + roomward * SILL_IN), // inner sill board
            box(from - SILL_OUT, to + SILL_OUT, bottom, sill, outer, outer - roomward * SILL_OUT) // outer sill
        ] : [])
    ];

    // the leaves' extent along x and their tracks across (c), per operation
    let lo, hi, y1, track;
    const sashDepth = Math.min(SASH_DEPTH, (c1 - c0) / 2);
    if (isFlush) {
        // over the lining, the whole reveal but the gap all round: flush with the swing face
        [lo, hi] = [from + LEAF_GAP, to - LEAF_GAP];
        y1 = top - LEAF_GAP;
        track = () => [face, face - side * LEAF_THICKNESS];
    } else if (operation === 'swing' || operation === 'standard') {
        [lo, hi] = [from + LINING + LEAF_GAP, to - LINING - LEAF_GAP];
        y1 = top - LINING - LEAF_GAP;
        track = operation === 'standard' ? () => [axis - sashDepth / 2, axis + sashDepth / 2] // fixed: on the axis
            : () => [face, face - side * (isWindow ? sashDepth : LEAF_THICKNESS)];               // flush with the face
    } else if (operation === 'slide' && isWindow) {
        // classic sliding window: inside the lining, each leaf on its own track across the reveal (centered on
        // the axis, the fixed leaf outermost); rank = the leaf's place counted from the fixed end
        [lo, hi] = [from + LINING + LEAF_GAP, to - LINING - LEAF_GAP];
        y1 = top - LINING - LEAF_GAP;
        const count = sides.length;
        const thickness = Math.min(SLIDE_THICKNESS, (WINDOW_TRACKS_DEPTH * (c1 - c0) - (count - 1) * TRACK_GAP) / count);
        const outermost = axis - roomward * (count * thickness + (count - 1) * TRACK_GAP) / 2;
        track = (i) => {
            const near = outermost + roomward * windowRank(i) * (thickness + TRACK_GAP);
            return [near, near + roomward * thickness];
        };
    } else if (operation === 'slide') {
        // in front of the face (past the casing), covering the casing too; two alternating tracks
        [lo, hi] = [from - out, to + out];
        y1 = top + out;
        track = (i) => {
            const near = face + side * (CASING_DEPTH + SLIDE_GAP + (i % 2) * (SLIDE_THICKNESS + TRACK_GAP));
            return [near, near + side * SLIDE_THICKNESS];
        };
    } else {
        // pocket: one track on the wall's axis (at most 2 leaves, parting: never in each other's way), into the
        // wall on the pocket sides
        [lo, hi] = [pocketStart ? from : from + LINING + LEAF_GAP, pocketEnd ? to : to - LINING - LEAF_GAP];
        y1 = top - LINING - LEAF_GAP;
        const thickness = Math.min(SLIDE_THICKNESS, (c1 - c0) / 4);
        track = () => [axis - thickness / 2, axis + thickness / 2];
    }
    const y0 = isWindow ? sill + LEAF_GAP : FLOOR_GAP;
    const handleY = isWindow ? (y0 + y1) / 2 : HANDLE_HEIGHT;
    const style = handleStyle(partStyles, opening);
    // fixed window: one sash; sliding window: every leaf's fixed side is the fixed end (its handle at the far edge)
    const spans = operation === 'standard' ? [{ from: lo, to: hi, towardsStart: true }]
        : openingLeaves(opening, lo, hi).map((span) => (isSlidingWindow ? { ...span, towardsStart: fixedAtStart } : span));
    const leafWidth = (hi - lo) / spans.length;
    const leaves = spans.map((full, index) => {
        // half the meeting gap off each edge that touches another leaf
        const span = { ...full, from: full.from + (index > 0 ? MEETING_GAP / 2 : 0), to: full.to - (index < spans.length - 1 ? MEETING_GAP / 2 : 0) };
        const leafC = track(index);
        const hingeX = span.towardsStart ? span.from : span.to;
        const freeX = span.towardsStart ? span.to : span.from;
        const toFree = Math.sign(freeX - hingeX);      // +1: the leaf runs towards +x from its fixed side
        const handleX = freeX - toFree * HANDLE_INSET;
        const [cMin, cMax] = [Math.min(...leafC), Math.max(...leafC)];
        // the leaf faces a handle goes on, as [surface, outwards along c]: doors both, windows the room's side
        const faces = isWindow ? [roomward > 0 ? [cMax, 1] : [cMin, -1]] : [[cMin, -1], [cMax, 1]];
        const handle = operation === 'standard' || (isSlidingWindow && windowRank(index) === 0) ? []
            : handleBoxes(style, handleX, handleY, isWindow ? 0 : toFree, faces, isWindow);
        const leaf = box(span.from, span.to, y0, y1, leafC[0], leafC[1]);
        return {
            // pivot origin of the leaf (renderer): the hinge for a swing leaf, its fixed edge on the track otherwise
            hinge: [hingeX, operation === 'swing' ? face : leafC[0]],
            // swing: the free edge (dx = toFree * w) must end on the swing side (dc = side * w): sin a = side * toFree
            openAngle: operation === 'swing' ? (Math.PI / 2) * side * toFree : 0,
            // sliding: mirrored out of the leaves' extent on its side (stacked leaves never overlap)
            // pocket: short of the full travel, so the leaf stays POCKET_GRIP out of the jamb lining
            // sliding window: onto the fixed leaf's place
            openShift: operation === 'swing' || operation === 'standard' ? 0
                : isSlidingWindow ? (fixedAtStart ? -1 : 1) * windowRank(index) * leafWidth
                : (span.towardsStart ? 2 * lo - span.from - span.to : 2 * hi - span.from - span.to)
                    + (operation === 'pocket' ? (span.towardsStart ? 1 : -1) * (LINING + POCKET_GRIP) : 0),
            leaf,
            ...(isWindow ? glazed(leaf) : {}),
            handle
        };
    });
    // pocket sides: a split jamb, the lining on both sides of the slot the leaves run through
    for (const [isStart, x0] of [[true, from], [false, to - LINING]]) {
        if (!(isStart ? pocketStart : pocketEnd)) continue;
        const slot = spans.flatMap((s, i) => (s.towardsStart === isStart ? track(i) : []));
        frame.push(box(x0, x0 + LINING, bottom, top, c0, Math.min(...slot) - LEAF_GAP), box(x0, x0 + LINING, bottom, top, Math.max(...slot) + LEAF_GAP, c1));
    }
    if (operation === 'slide' && !isWindow) {
        // the rail above the leaves: from closed to open (as far as the open leaves reach), deep enough for both tracks
        const ends = leaves.flatMap(({ leaf, openShift }) => [leaf.min[0] + openShift, leaf.max[0] + openShift]);
        const railC = [face + side * CASING_DEPTH, face + side * (CASING_DEPTH + SLIDE_GAP + 2 * SLIDE_THICKNESS + TRACK_GAP + SLIDE_GAP)];
        frame.push(box(Math.min(lo, ...ends), Math.max(hi, ...ends), y1 + RAIL_GAP, Math.min(y1 + RAIL_GAP + RAIL_HEIGHT, wallHeight), railC[0], railC[1]));
    }
    return { frame, leaves };
}

// A window leaf: a sash (a frame SASH wide, thinner on a small leaf) around a glass pane in its middle
function glazed({ min, max }) {
    const w = Math.min(SASH, (max[0] - min[0]) / 4, (max[1] - min[1]) / 4);
    const mid = (min[2] + max[2]) / 2;
    return {
        sash: [
            box(min[0], min[0] + w, min[1], max[1], min[2], max[2]), box(max[0] - w, max[0], min[1], max[1], min[2], max[2]),
            box(min[0] + w, max[0] - w, min[1], min[1] + w, min[2], max[2]), box(min[0] + w, max[0] - w, max[1] - w, max[1], min[2], max[2])
        ],
        glass: box(min[0] + w, max[0] - w, min[1] + w, max[1] - w, mid - GLASS / 2, mid + GLASS / 2)
    };
}

// The boxes of a handle of `style` (HANDLE_STYLES) on each given face, at (x, y)
function handleBoxes(style, x, y, toFree, faces, isWindow) {
    if (style === 'lever') return leverHandle(x, y, toFree, faces);
    if (style === 'knob') return knobHandle(x, y, faces);
    if (style === 'bar') return barHandle(x, y, faces);
    if (style === 'recessed') return pullHandle(x, y, isWindow ? WINDOW_PULL : PULL, faces);
    return []; // 'none'
}

// A rose, a short stem and a knob (a squat box: boxes only for now) on each given face
function knobHandle(x, y, faces) {
    return faces.flatMap(([surface, s]) => [
        box(x - ROSE[0] / 2, x + ROSE[0] / 2, y - ROSE[1] / 2, y + ROSE[1] / 2, surface, surface + s * ROSE[2]),
        box(x - STEM / 2, x + STEM / 2, y - STEM / 2, y + STEM / 2, surface, surface + s * (KNOB_OUT - KNOB[2] / 2)),
        box(x - KNOB[0] / 2, x + KNOB[0] / 2, y - KNOB[1] / 2, y + KNOB[1] / 2, surface + s * (KNOB_OUT - KNOB[2] / 2), surface + s * (KNOB_OUT + KNOB[2] / 2))
    ]);
}

// Hinged: a rose, a stem and a lever on each given face ([surface, outwards]); the lever towards the hinge
// (toFree: +1 / -1 = the leaf runs towards +x / -x from its hinge) or, toFree 0, down (a window's)
function leverHandle(x, y, toFree, faces) {
    const lever = toFree === 0 ? [x - LEVER[1] / 2, x + LEVER[1] / 2, y - LEVER[0], y + LEVER[1] / 2]
        : [x, x - toFree * LEVER[0], y - LEVER[1] / 2, y + LEVER[1] / 2];
    return faces.flatMap(([surface, s]) => [
        box(x - ROSE[0] / 2, x + ROSE[0] / 2, y - ROSE[1] / 2, y + ROSE[1] / 2, surface, surface + s * ROSE[2]),
        // stem: from the rose out to the lever's far side, on the handle's axis
        box(x - STEM / 2, x + STEM / 2, y - STEM / 2, y + STEM / 2, surface, surface + s * (LEVER_OUT + LEVER[2] / 2)),
        box(lever[0], lever[1], lever[2], lever[3], surface + s * (LEVER_OUT - LEVER[2] / 2), surface + s * (LEVER_OUT + LEVER[2] / 2))
    ]);
}

// Sliding door on a face: a vertical bar on two short stems, on each given face
function barHandle(x, y, faces) {
    const [y0, y1] = [y - BAR_LENGTH / 2, y + BAR_LENGTH / 2];
    return faces.flatMap(([surface, s]) => [
        box(x - STEM / 2, x + STEM / 2, y0 - BAR / 2, y1 + BAR / 2, surface + s * (BAR_OUT - BAR / 2), surface + s * (BAR_OUT + BAR / 2)),
        ...[y0, y1].map((yy) => box(x - STEM / 2, x + STEM / 2, yy - STEM / 2, yy + STEM / 2, surface, surface + s * BAR_OUT))
    ]);
}

// Pocket door, sliding window: a flat pull plate on each given face (nothing must stick out)
function pullHandle(x, y, [w, h, d], faces) {
    return faces.map(([surface, s]) => box(x - w / 2, x + w / 2, y - h / 2, y + h / 2, surface, surface + s * d));
}
