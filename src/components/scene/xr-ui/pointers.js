import { createContext } from 'react';

/*
* Which pointers can press the in-VR UI (pmndrs pointerEventsType filters; pointerState = the XR input
* source state of the pointer, with inputSource.handedness):
* - hands: only the index-finger "touch" pointer. The hand ray is excluded (no accidental presses
*   while aiming at the scene; rays pass through the menu) and so is the "grab" pointer, which sits on
*   the same fingertip and would otherwise win ties against "touch".
* - controllers: the ray (trigger), since controllers have no touch pointer.
*/
export function acceptsPointer(_pointerId, pointerType, pointerState) {
    if (pointerType === 'touch') return true;
    return pointerType === 'ray' && pointerState?.type === 'controller';
}

/*
* Wrist menu (left wrist): same as acceptsPointer, but never the LEFT hand's own fingertip. Those fingers
* sit right next to the menu, and bending them (a hand not held flat, a sudden curl) pressed its buttons
* by accident; the menu is meant to be pressed by the other hand.
*/
export function acceptsWristPointer(pointerId, pointerType, pointerState) {
    if (pointerType === 'touch' && pointerState?.inputSource?.handedness === 'left') return false;
    return acceptsPointer(pointerId, pointerType, pointerState);
}

/*
* Panels placed in the room (e.g. the VR sun panel): also the hand ray (pinch to press, keep pinching to
* drag a slider). Unlike the wrist menu, these panels are aimed at on purpose, far from the scene's objects.
*/
export function acceptsPanelPointer(_pointerId, pointerType) {
    return pointerType === 'touch' || pointerType === 'ray';
}

/*
* Pointer filter used by VRButton / VRSlider below this provider: acceptsPointer by default, the
* WristMenu provides acceptsWristPointer for everything attached to the wrist (buttons, catalog...),
* VRSunPanel provides acceptsPanelPointer.
*/
export const PointerFilterContext = createContext(acceptsPointer);
