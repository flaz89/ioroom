import { useLayoutEffect, useRef } from 'react';
import { Vector3 } from 'three';
import { useThree } from '@react-three/fiber';
import { useStore } from '../../../store/appStore';
import { SYNC_HOST, isAdmin } from '../../../sync/roomSync';
import { CITIES, findCity } from '../sun/sun';
import { formatDay, formatTime } from '../sun/format';
import { drawPanel, useCanvasTexture } from './useCanvasTexture';
import VRButton from './VRButton';
import VRSlider from './VRSlider';

/*
* In-VR sun panel (store openPanel 'sun', opened from the wrist menu): the same settings as the desktop
* sun panel (components/ui/sun-panel/SunPanel.jsx), shared with the room (sync/sunSync.js).
* - everyone: day and time sliders (the sun arc shows while they move, like on desktop);
* - owner only (everyone when sync is off): location (< >, cycling the city list) and north slider.
*
* Placement: fixed in the world, in front of the user and a bit below the eyes when it opens (not on the
* wrist: a slider attached to the moving hand could not be dragged). Close with X or the wrist button.
* Distance within arm's reach: hands press it with the index fingertip, controllers with the ray.
* Calibration knobs: tune on the headset.
*/
const DISTANCE = 0.45;      // meters in front of the eyes (horizontal)
const BELOW_EYES = 0.18;    // meters below the eyes
const WIDTH = 0.3;          // meters
const ROW = 0.058;          // meters between rows
const TITLE_H = 0.04;
const PIXELS_PER_METER = 4000;
const PAD = 0.02;

const _eye = new Vector3();
const _forward = new Vector3();

// Plain text on a transparent canvas (titles, the city name)
function VRText({ text, width, height = 0.03, align = 'left', bold = true, ...groupProps }) {
    const texture = useCanvasTexture(Math.round(width * PIXELS_PER_METER), Math.round(height * PIXELS_PER_METER), (ctx, w, h) => {
        ctx.fillStyle = '#ffffff';
        ctx.font = `${bold ? 600 : 400} ${Math.round(h * 0.6)}px "SUSE Mono", monospace`;
        ctx.textAlign = align;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, align === 'center' ? w / 2 : 0, h / 2);
    }, [text, align, bold]);
    return (
        <group {...groupProps}>
            <mesh raycast={() => null}>
                <planeGeometry args={[width, height]} />
                {/* depthWrite off: a transparent text quad must never hide the panel background behind it */}
                <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
            </mesh>
        </group>
    );
}

export default function VRSunPanel() {
    const groupRef = useRef();
    const getThree = useThree((state) => state.get);
    const sun = useStore((state) => state.sun);
    const setSun = useStore((state) => state.setSun);
    const showSunArc = useStore((state) => state.showSunArc);
    const closePanel = useStore((state) => state.closePanel);
    const canEditEnvironment = !SYNC_HOST || isAdmin; // location and north

    // Place once, when it opens: in front of the user, facing the eyes
    useLayoutEffect(() => {
        const camera = getThree().camera; // follows the headset during XR sessions
        camera.getWorldPosition(_eye);
        camera.getWorldDirection(_forward).setY(0);
        if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, -1);
        _forward.normalize();
        const group = groupRef.current;
        group.position.set(_eye.x + _forward.x * DISTANCE, _eye.y - BELOW_EYES, _eye.z + _forward.z * DISTANCE);
        group.lookAt(_eye); // a plane's front (+Z) towards the eyes, slightly tilted up
    }, [getThree]);

    // Rows from the top: title, [location], day, time, [north]
    const rows = canEditEnvironment ? ['city', 'day', 'time', 'north'] : ['day', 'time'];
    const height = TITLE_H + rows.length * ROW + PAD;
    const top = height / 2;
    const rowY = (index) => top - TITLE_H - ROW * (index + 0.5);
    const innerWidth = WIDTH - PAD * 2;

    const background = useCanvasTexture(Math.round(WIDTH * 2000), Math.round(height * 2000), (ctx, w, h) => drawPanel(ctx, w, h), [height]);
    const cityIndex = CITIES.findIndex((city) => city.id === sun.cityId);
    const cycleCity = (offset) => setSun({ cityId: CITIES[(cityIndex + offset + CITIES.length) % CITIES.length].id });
    const setShowingArc = (patch) => { setSun(patch); showSunArc(); };

    return (
        <group ref={groupRef}>
            {/* Background: catches presses so they never reach the scene behind the panel.
                renderOrder -1: drawn before the (transparent) texts and controls on top of it */}
            <mesh position-z={-0.001} renderOrder={-1} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                <planeGeometry args={[WIDTH, height]} />
                <meshBasicMaterial map={background} transparent toneMapped={false} />
            </mesh>

            <VRText text={`Sun · ${findCity(sun.cityId).name}`} width={innerWidth - 0.03} position={[-0.015, top - TITLE_H / 2 - 0.004, 0.001]} />
            <VRButton label="X" size={[0.026, 0.026]} onClick={closePanel} position={[WIDTH / 2 - PAD, top - TITLE_H / 2 - 0.004, 0.001]} />

            {rows.map((row, index) => {
                const y = rowY(index);
                if (row === 'city') return (
                    <group key={row} position={[0, y, 0.001]}>
                        <VRButton label="<" size={[0.03, 0.03]} onClick={() => cycleCity(-1)} position={[-innerWidth / 2 + 0.015, 0, 0]} />
                        <VRText text={findCity(sun.cityId).name} width={innerWidth - 0.08} align="center" />
                        <VRButton label=">" size={[0.03, 0.03]} onClick={() => cycleCity(1)} position={[innerWidth / 2 - 0.015, 0, 0]} />
                    </group>
                );
                if (row === 'day') return (
                    <VRSlider key={row} label={`Day ${formatDay(sun.day)}`} value={sun.day} min={1} max={365}
                        onChange={(day) => setShowingArc({ day })} width={innerWidth} position={[0, y, 0.001]} />
                );
                if (row === 'time') return (
                    <VRSlider key={row} label={`Time ${formatTime(sun.minutes)}`} value={sun.minutes} min={0} max={1435} step={5}
                        onChange={(minutes) => setShowingArc({ minutes })} width={innerWidth} position={[0, y, 0.001]} />
                );
                return (
                    <VRSlider key={row} label={`North ${sun.northDeg}°`} value={sun.northDeg} min={0} max={359}
                        onChange={(northDeg) => setSun({ northDeg })} width={innerWidth} position={[0, y, 0.001]} />
                );
            })}
        </group>
    );
}
