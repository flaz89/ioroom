import { useLayoutEffect, useRef } from 'react';
import { Vector3 } from 'three';
import { useThree } from '@react-three/fiber';
import { useStore } from '../../../store/appStore';
import { formatLength } from '../measure/measureSnap';
import { drawPanel, useCanvasTexture } from './useCanvasTexture';
import VRButton from './VRButton';
import VRGrabBar from './VRGrabBar';
import { PointerFilterContext, acceptsPanelPointer } from './pointers';
import { VR_PANEL, placeInFrontOfUser } from './layout';

/*
* In-VR actions of the selected ruler measure (ruler on, select its label: scene/measure/Measures.jsx),
* like the desktop Html actions: Save (my temporary measures: share them with the room), Delete, X.
* World panel in front of the user, movable with its grab bar. The length shown is the stored one.
*/
const DISTANCE = 0.45;
const BELOW_EYES = 0.2;
const WIDTH = 0.26;
const HEIGHT = 0.1;
const PAD = 0.015;
const BUTTON = [0.07, 0.03];

export default function VRMeasurePanel() {
    const selectedId = useStore((state) => state.measures.selectedId);
    const measure = useStore((state) => state.measures.local.find((item) => item.id === selectedId)
        ?? state.measures.items.find((item) => item.id === selectedId));
    if (measure == null) return null;
    // keyed: a fresh panel (placed in front of the user) for every measure selected
    return <MeasureActions key={measure.id} measure={measure} saved={useStore.getState().measures.items.includes(measure)} />;
}

const point = (end) => new Vector3(...(Array.isArray(end) ? end : end.p));

function MeasureActions({ measure, saved }) {
    const groupRef = useRef();
    const getThree = useThree((state) => state.get);
    const { selectMeasure, saveMeasure, removeMeasure } = useStore.getState();
    const text = `${saved ? 'Measure' : 'My measure'} · ${formatLength(point(measure.a).distanceTo(point(measure.b)))}`;

    useLayoutEffect(() => {
        placeInFrontOfUser(groupRef.current, getThree().camera, DISTANCE, BELOW_EYES);
    }, [getThree]);

    const background = useCanvasTexture(Math.round(WIDTH * 2000), Math.round(HEIGHT * 2000), (ctx, w, h) => {
        drawPanel(ctx, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 ${Math.round(h * 0.2)}px "SUSE Mono", monospace`;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, w * 0.07, h * 0.28, w * 0.75);
    }, [text]);

    const top = HEIGHT / 2;
    const buttonsY = -HEIGHT / 2 + PAD + BUTTON[1] / 2;
    return (
        <PointerFilterContext.Provider value={acceptsPanelPointer}>
            <group ref={groupRef}>
                <mesh position-z={-0.001} renderOrder={-1} userData={VR_PANEL} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                    <planeGeometry args={[WIDTH, HEIGHT]} />
                    <meshBasicMaterial map={background} transparent toneMapped={false} />
                </mesh>
                <VRButton label="X" size={[0.026, 0.026]} onClick={() => selectMeasure(null)} position={[WIDTH / 2 - PAD, top - PAD - 0.006, 0.001]} />
                <group position={[0, buttonsY, 0.001]}>
                    {!saved && <VRButton label="Save" size={BUTTON} active onClick={() => saveMeasure(measure.id)} position={[-WIDTH / 2 + PAD + BUTTON[0] / 2, 0, 0]} />}
                    <VRButton label="Delete" size={BUTTON} onClick={() => removeMeasure(measure.id)} position={[WIDTH / 2 - PAD - BUTTON[0] / 2, 0, 0]} />
                </group>
                <VRGrabBar targetRef={groupRef} y={-HEIGHT / 2 - 0.022} />
            </group>
        </PointerFilterContext.Provider>
    );
}
