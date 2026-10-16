import { useEffect, useRef, useState } from 'react';
import { Vector3 } from 'three';
import { useThree } from '@react-three/fiber';
import { XRSpace, useXRInputSourceState } from '@react-three/xr';
import { useStore } from '../../../store/appStore';
import { GRID_SNAP_STEPS, ROTATION_SNAP_STEPS } from '../../../store/slices/settingSlice';
import { svg } from '../../../utils/svg-logos';
import { useFacingViewer } from './useFacingViewer';
import VRButton from './VRButton';
import { BUTTON_SIZE } from './layout';
import VRCatalogPanel from './VRCatalogPanel';
import VRStatsPanel from './VRStatsPanel';
import { PointerFilterContext, acceptsWristPointer } from './pointers';

/*
* Menu attached to the LEFT controller (or left hand when hand tracking is active), pressed with
* the right hand: ray + trigger/pinch, or poking with the index finger. The left hand's own fingers
* can never press it (acceptsWristPointer, pointers.js): curling them used to hit the buttons.
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
const STEP_X = BUTTON_SIZE[0] + 0.006; // meters: snap step buttons, to the right of their snap toggle

// Next step in the list (wraps around); a value not in the list restarts from the first
const nextStep = (steps, current) => steps[(steps.indexOf(current) + 1) % steps.length];

// Tabletop toggle (no desktop logo): a small table seen from the front
function tabletopIcon(ctx, x, y, s) {
    ctx.lineWidth = Math.max(2, s * 0.08);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.45, y - s * 0.12); // top
    ctx.lineTo(x + s * 0.45, y - s * 0.12);
    ctx.moveTo(x - s * 0.32, y - s * 0.12); // legs
    ctx.lineTo(x - s * 0.32, y + s * 0.38);
    ctx.moveTo(x + s * 0.32, y - s * 0.12);
    ctx.lineTo(x + s * 0.32, y + s * 0.38);
    ctx.stroke();
    ctx.strokeRect(x - s * 0.12, y - s * 0.38, s * 0.24, s * 0.2); // the model on it
}

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

    const isPerfVisible = useStore((state) => state.perfOpen);
    const togglePanel = useStore((state) => state.togglePanel);
    const togglePerf = useStore((state) => state.togglePerf);
    const isSunOpen = useStore((state) => state.openPanel === 'sun'); // VRSunPanel (rendered by Level, in world space)
    const isMaterialsOpen = useStore((state) => state.openPanel === 'materials'); // VRMaterialsPanel (same)
    // post-it placing mode: the next trigger/pinch aimed at a surface sticks a note (scene/notes/Notes.jsx)
    const isPlacingNote = useStore((state) => state.notes.placing);
    const setPlacingNote = useStore((state) => state.setPlacingNote);
    const isTabletop = useStore((state) => state.view.mode === 'tabletop');
    const toggleTabletop = useStore((state) => state.toggleTabletop);
    const { gridSnap, gridSnapStep, rotationSnap, rotationSnapStep } = useStore((state) => state.settings);
    const toggleGridSnap = useStore((state) => state.toggleGridSnap);
    const setGridSnapStep = useStore((state) => state.setGridSnapStep);
    const toggleRotationSnap = useStore((state) => state.toggleRotationSnap);
    const setRotationSnapStep = useStore((state) => state.setRotationSnapStep);
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
                {/*
                * Always mounted (created when the session starts): mounting it the first time the wrist
                * turned built every button's canvas texture in that frame, a visible hitch. Hidden, it
                * is not drawn and pointerEvents="none" (inherited by every button) keeps it unpressable.
                */}
                <group visible={isVisible} pointerEvents={isVisible ? undefined : 'none'}>
                    <PointerFilterContext.Provider value={acceptsWristPointer}>
                        {/* Buttons stacked along the menu's local +Y (the palm becomes the control board) */}
                        <VRButton svg={svg.performance} active={isPerfVisible} onClick={togglePerf} />
                        <VRButton svg={svg.sun} active={isSunOpen} onClick={() => togglePanel('sun')} position={[STEP_X, 0, 0]} />
                        <VRButton icon={tabletopIcon} active={isTabletop} onClick={toggleTabletop} position={[0, BUTTON_STEP, 0]} />
                        <VRButton svg={svg.materials} active={isMaterialsOpen} onClick={() => togglePanel('materials')} position={[STEP_X, BUTTON_STEP, 0]} />
                        <VRButton svg={svg.add} active={isCatalogOpen} onClick={() => setIsCatalogOpen(!isCatalogOpen)} position={[0, BUTTON_STEP * 2, 0]} />
                        <VRButton svg={svg.note} active={isPlacingNote} onClick={() => setPlacingNote(!isPlacingNote)} position={[STEP_X, BUTTON_STEP * 2, 0]} />
                        {/* Snaps: toggle on the left, current step on the right (press = next step, turns the snap on) */}
                        <VRButton svg={svg.gridSnap} active={gridSnap} onClick={toggleGridSnap} position={[0, BUTTON_STEP * 3, 0]} />
                        <VRButton label={`${gridSnapStep}cm`} active={gridSnap} onClick={() => setGridSnapStep(nextStep(GRID_SNAP_STEPS, gridSnapStep))} position={[STEP_X, BUTTON_STEP * 3, 0]} />
                        <VRButton svg={svg.rotationSnap} active={rotationSnap} onClick={toggleRotationSnap} position={[0, BUTTON_STEP * 4, 0]} />
                        <VRButton label={`${rotationSnapStep}°`} active={rotationSnap} onClick={() => setRotationSnapStep(nextStep(ROTATION_SNAP_STEPS, rotationSnapStep))} position={[STEP_X, BUTTON_STEP * 4, 0]} />
                        {isPerfVisible && <VRStatsPanel position={[0, BUTTON_STEP * 4 + BUTTON_SIZE[1] / 2 + 0.06, 0]} />}
                        {isCatalogOpen && <VRCatalogPanel onPick={addFromCatalog} position={[SIDE_PANEL_X, BUTTON_STEP, 0]} />}
                    </PointerFilterContext.Provider>
                </group>

            </group>
        </XRSpace>
    );
}
