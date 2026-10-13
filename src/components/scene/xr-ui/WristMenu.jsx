import { useEffect, useRef, useState } from 'react';
import { Vector3 } from 'three';
import { useThree } from '@react-three/fiber';
import { XRSpace, useXRInputSourceState } from '@react-three/xr';
import { useStore } from '../../../store/appStore';
import { useFacingViewer } from './useFacingViewer';
import VRButton from './VRButton';
import { BUTTON_SIZE } from './layout';
import VRCatalogPanel from './VRCatalogPanel';
import VRStatsPanel from './VRStatsPanel';

/*
* Menu attached to the LEFT controller (or left hand when hand tracking is active), pressed with
* the right hand: ray + trigger/pinch, or poking with the index finger.
* It is shown only while it faces the eyes (palm/wrist turned towards the face): with the palm
* down or a closed fist it disappears, so fingers cannot press it by accident.
*
* Placement is relative to the input source grip space (origin in the palm, -Z forward, +Y up when
* holding a controller). Calibration knobs: tune on the headset.
*/
const MENU_POSITION = [0.002, 0.07, 0];        // meters: above the back of the hand
const MENU_ROTATION = [-Math.PI / 2,  Math.PI / 2, -Math.PI / 2];  // calibrated on the headset

const BUTTON_STEP = BUTTON_SIZE[1] + 0.008; // meters between stacked buttons (height + gap)
const SIDE_PANEL_X = 0.115;  // meters: catalog panel center, to the side of the button column
const SPAWN_DISTANCE = 1.2;  // meters in front of the user for objects added at 1:1 scale

const _eye = new Vector3();
const _forward = new Vector3();

export default function WristMenu() {
    const controller = useXRInputSourceState('controller', 'left');
    const hand = useXRInputSourceState('hand', 'left');
    const gripSpace = (controller ?? hand)?.inputSource.gripSpace;

    const menuRef = useRef();
    const isVisible = useFacingViewer(menuRef);
    // Shared with FistDeleteGesture: the same hand opens the menu, so the gesture is disabled while it is shown
    const setHandMenuVisible = useStore((state) => state.setHandMenuVisible);
    useEffect(() => {
        setHandMenuVisible(isVisible);
        return () => setHandMenuVisible(false);
    }, [isVisible, setHandMenuVisible]);
    const [isCatalogOpen, setIsCatalogOpen] = useState(false);
    const getThree = useThree((state) => state.get);

    const isPerfVisible = useStore((state) => state.settings.perfVisibility);
    const togglePerf = useStore((state) => state.togglePerf);
    const isTabletop = useStore((state) => state.view.mode === 'tabletop');
    const toggleTabletop = useStore((state) => state.toggleTabletop);
    const gridSnap = useStore((state) => state.settings.gridSnap);
    const toggleGridSnap = useStore((state) => state.toggleGridSnap);
    const addObject = useStore((state) => state.addObject);

    // Tabletop: in the middle of the model. 1:1: on the floor in front of the user (board = identity).
    const addFromCatalog = (type) => {
        if (isTabletop) {
            addObject(type);
        } else {
            const camera = getThree().camera;
            camera.getWorldPosition(_eye);
            camera.getWorldDirection(_forward).setY(0);
            if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, -1);
            _forward.normalize();
            addObject(type, [_eye.x + _forward.x * SPAWN_DISTANCE, 0.5, _eye.z + _forward.z * SPAWN_DISTANCE]);
        }
        setIsCatalogOpen(false);
    };

    if (gripSpace == null) return null;

    return (
        <XRSpace space={gripSpace}>
            <group ref={menuRef} position={MENU_POSITION} rotation={MENU_ROTATION}>
                {/* Unmounted (not just hidden) so hidden buttons can never receive pointer events */}
                {isVisible && (
                    <>
                        {/* Buttons stacked along the menu's local +Y (the palm becomes the control board) */}
                        <VRButton label="Stats" active={isPerfVisible} onClick={togglePerf} />
                        <VRButton label="Tabletop" active={isTabletop} onClick={toggleTabletop} position={[0, BUTTON_STEP, 0]} />
                        <VRButton label="Add" active={isCatalogOpen} onClick={() => setIsCatalogOpen(!isCatalogOpen)} position={[0, BUTTON_STEP * 2, 0]} />
                        <VRButton label="Snap" active={gridSnap} onClick={toggleGridSnap} position={[0, BUTTON_STEP * 3, 0]} />
                        {isPerfVisible && <VRStatsPanel position={[0, BUTTON_STEP * 3 + BUTTON_SIZE[1] / 2 + 0.06, 0]} />}
                        {isCatalogOpen && <VRCatalogPanel onPick={addFromCatalog} position={[SIDE_PANEL_X, BUTTON_STEP, 0]} />}
                    </>
                )}

            </group>
        </XRSpace>
    );
}
