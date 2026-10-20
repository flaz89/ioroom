import { faceOffsets, openingLeaves, openingOperation, openingRects } from '../../../../plan/planModel.js';

/*
* 3D DOOR as data (pure, no three.js): the boxes a hinged door is made of, in the OPENING's local frame, so
* Openings3D.jsx only turns them into meshes and the rules can be checked in Node.
*
* Local frame: x = along the wall's drawn line (meters from the wall's start `a`), y = up from the floor,
* c = across, along the wall's normal (planModel.wallFrame; the faces are at faceOffsets inner / outer).
* A box: { min: [x, y, c], max: [x, y, c] }.
*
* doorParts(wall, opening, wallHeight) -> null | { frame: [box], leaves: [{ hinge: [x, c], openAngle, leaf: box, handle: [box] }] }
* - Only doors with operation 'swing' for now (sliding, pocket and windows come later): null otherwise, or
*   when the opening is clipped away (openingRects).
* - FRAME (part 'frame'): a lining on the three sides of the reveal (jambs + head, LINING thick, the wall's
*   full depth) and a casing (architrave) on both wall faces, CASING_WIDTH wide, CASING_DEPTH proud.
* - LEAVES (part 'leaf', planModel.openingLeaves: count, hinge side): inside the lining, LEAF_GAP clear,
*   LEAF_THICKNESS thick, flush with the face on the swing side ('in' = the inner face side, -normal as in
*   the 2D symbol: the face with the smaller c; 'out' = the larger c). hinge: the vertical axis at the
*   leaf's hinge edge on that face. openAngle: rotation (radians) in the x-c plane around the hinge that
*   opens the leaf towards the swing side: a point (dx, dc) from the hinge goes to
*   (dx cos a - dc sin a, dx sin a + dc cos a). The leaf and handle boxes are given CLOSED, in the same
*   frame (the renderer rotates them around the hinge).
* - Leaves of the same door meet with MEETING_GAP between them (the joint shows in 3D).
* - HANDLE (part 'handle'): on both faces of each leaf, near its free edge, at HANDLE_HEIGHT: a rose on the
*   face, a stem out of it (perpendicular to the leaf) and the lever, along the leaf towards the hinge.
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

const box = (x0, x1, y0, y1, c0, c1) => ({ min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(c0, c1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(c0, c1)] });

export function doorParts(wall, opening, wallHeight) {
    if (opening.type !== 'door' || openingOperation(opening) !== 'swing') return null;
    const rect = openingRects({ ...wall, openings: [opening] }, wallHeight)[0];
    if (rect == null) return null;
    const { from, to, top } = rect;
    const { inner, outer } = faceOffsets(wall);
    const c0 = Math.min(inner, outer), c1 = Math.max(inner, outer);
    const out = CASING_WIDTH - LINING; // casing beyond the reveal

    const frame = [
        box(from, from + LINING, 0, top, c0, c1),            // jambs
        box(to - LINING, to, 0, top, c0, c1),
        box(from, to, top - LINING, top, c0, c1),           // head
        ...[[c0 - CASING_DEPTH, c0], [c1, c1 + CASING_DEPTH]].flatMap(([a, b]) => [
            box(from - out, from + LINING, 0, top + out, a, b), // casing: sides and head, on each face
            box(to - LINING, to + out, 0, top + out, a, b),
            box(from - out, to + out, top - LINING, top + out, a, b)
        ])
    ];

    const isOut = opening.swing === 'out';
    const side = isOut ? 1 : -1;                     // the swing side, along c
    const face = isOut ? c1 : c0;                    // the leaf is flush with this face
    const leafC = [face, face - side * LEAF_THICKNESS];
    const y0 = FLOOR_GAP, y1 = top - LINING - LEAF_GAP;
    const spans = openingLeaves(opening, from + LINING + LEAF_GAP, to - LINING - LEAF_GAP);
    const leaves = spans.map((full, index) => {
        // half the meeting gap off each edge that touches another leaf
        const span = { ...full, from: full.from + (index > 0 ? MEETING_GAP / 2 : 0), to: full.to - (index < spans.length - 1 ? MEETING_GAP / 2 : 0) };
        const hingeX = span.towardsStart ? span.from : span.to;
        const freeX = span.towardsStart ? span.to : span.from;
        const toFree = Math.sign(freeX - hingeX);      // +1: the leaf runs towards +x from its hinge
        const handleX = freeX - toFree * HANDLE_INSET;
        const handle = [-1, 1].flatMap((s) => {        // s: the leaf face (beyond leafC[0] or leafC[1])
            const surface = s > 0 ? Math.max(...leafC) : Math.min(...leafC); // that face of the leaf
            return [
                box(handleX - ROSE[0] / 2, handleX + ROSE[0] / 2, HANDLE_HEIGHT - ROSE[1] / 2, HANDLE_HEIGHT + ROSE[1] / 2, surface, surface + s * ROSE[2]),
                // stem: from the rose out to the lever's far side, on the handle's axis
                box(handleX - STEM / 2, handleX + STEM / 2, HANDLE_HEIGHT - STEM / 2, HANDLE_HEIGHT + STEM / 2, surface, surface + s * (LEVER_OUT + LEVER[2] / 2)),
                box(handleX, handleX - toFree * LEVER[0], HANDLE_HEIGHT - LEVER[1] / 2, HANDLE_HEIGHT + LEVER[1] / 2,
                    surface + s * (LEVER_OUT - LEVER[2] / 2), surface + s * (LEVER_OUT + LEVER[2] / 2))
            ];
        });
        return {
            hinge: [hingeX, face],
            // the free edge (dx = toFree * w) must end on the swing side (dc = side * w): sin a = side * toFree
            openAngle: (Math.PI / 2) * side * toFree,
            leaf: box(span.from, span.to, y0, y1, leafC[0], leafC[1]),
            handle
        };
    });
    return { frame, leaves };
}
