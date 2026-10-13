import { MathUtils } from 'three';

/*
* Two-hand zoom math (pure, see useTwoHandZoom.js).
* start: { distance, scale, midpoint: Vector3, position: Vector3 } captured when the gesture began.
* Writes the new board position into `outPosition` and returns the new uniform scale:
* - scale follows the ratio between current and initial hand distance, clamped to [minScale, maxScale];
* - the board scales around the initial midpoint and then follows the current midpoint (pan).
*/
export function zoomAboutMidpoint(start, distance, midpoint, minScale, maxScale, outPosition) {
    const scale = MathUtils.clamp(start.scale * (distance / start.distance), minScale, maxScale);
    outPosition.copy(start.position).sub(start.midpoint).multiplyScalar(scale / start.scale).add(midpoint);
    return scale;
}
