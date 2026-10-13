import { Raycaster } from 'three';

const _raycaster = new Raycaster();

/*
* Returns the world-space ray of a pointer event.
* With pmndrs pointer events (Canvas events={noEvents} + <PointerEvents/>), `event.ray` of a mouse/touch
* ("screen-ray") pointer is built from the pointer quaternion and does not follow the cursor, which breaks
* PivotControls' drag math. For screen pointers the ray is rebuilt from the NDC coords + camera, exactly
* like R3F does; for XR pointers (controllers/hands) `event.ray` is already correct.
*/
export function getPointerRay(event) {
    // details.type is pmndrs-only ('screen-ray' = mouse/touch on the canvas); R3F events have no details
    if (event.intersection?.details?.type === 'screen-ray' && event.pointer != null && event.camera != null) {
        _raycaster.setFromCamera(event.pointer, event.camera);
        return _raycaster.ray;
    }
    return event.ray;
}
