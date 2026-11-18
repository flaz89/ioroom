import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import { useStore } from '../../../store/appStore';
import { activeLevel } from '../../../plan/planModel';
import { fitMinimap, minimapShapes } from '../../../plan/minimap';
import { useCanvasTexture } from './useCanvasTexture';
import { otherPlayers } from '../../ui/minimap/otherPlayers';

export const MAP_SIZE_M = 0.24; // the square map, meters
const PX = 512;                 // canvas
const PAD = 16;                 // px kept around the plan
const ARROW = 0.018;            // m, the walker's arrow
const noRaycast = () => null;
const MAX_OTHERS = 8;            // other players drawn (presence avatars at life size)
const DOT = 0.007;                // m, their dot
const _forward = new Vector3();

const trace = (ctx, points, toMap) => {
    ctx.beginPath();
    points.forEach((p, i) => { const [u, v] = toMap(p); if (i === 0) ctx.moveTo(u, v); else ctx.lineTo(u, v); });
    ctx.closePath();
    ctx.fill();
};

/*
* MINIMAP on the VR palm, no background (WristMenu.jsx, wrist "map" button, store vrMapOpen; shown with the wrist menu like the
* stats panel). Same drawing as the screen one (plan/minimap.js): floors, walls, door / window gaps on a canvas
* texture redrawn only when the plan changes; the walker = a separate orange arrow moved every frame from the
* headset's pose (life mode: world = plan; in the tabletop there is no "you are here", the arrow hides); the other
* players (ui/minimap/otherPlayers.js) as dots in their color with a tick where they look, MAX_OTHERS slots.
*/
export default function VRMinimap(groupProps) {
    const level = useStore((state) => activeLevel(state.plan));
    const arrowRef = useRef();
    const othersRef = useRef(); // MAX_OTHERS slots, each a dot + a tick towards where that player looks
    const fit = useMemo(() => {
        const shapes = minimapShapes(level);
        return { shapes, ...fitMinimap(shapes.bounds, PX, PAD) };
    }, [level]);

    const texture = useCanvasTexture(PX, PX, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h); // no background: only the plan over the palm
        const { shapes, toMap } = fit;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
        shapes.floors.forEach((points) => trace(ctx, points, toMap));
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        shapes.walls.forEach((points) => trace(ctx, points, toMap));
        // door / window gaps: cut out of the walls, then the floor's tint again (no background to paint)
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#000';
        shapes.openings.forEach((points) => trace(ctx, points, toMap));
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
        shapes.openings.forEach((points) => trace(ctx, points, toMap));
    }, [fit]);

    useFrame(({ camera }) => {
        const arrow = arrowRef.current;
        if (arrow == null) return;
        // panel meters of a plan point
        const onPanel = (x, z) => { const [u, v] = fit.toMap([x, z]); return [(u / PX - 0.5) * MAP_SIZE_M, (0.5 - v / PX) * MAP_SIZE_M]; };
        const others = otherPlayers();
        othersRef.current?.children.forEach((slot, i) => {
            const player = others[i];
            slot.visible = player != null;
            if (player == null) return;
            const [x, y] = onPanel(player.x, player.z);
            slot.position.set(x, y, 0.0015);
            slot.rotation.z = player.yaw;
            slot.children.forEach((part) => part.material.color.set(player.color));
        });
        const tabletop = useStore.getState().view.mode === 'tabletop';
        arrow.visible = !tabletop;
        if (tabletop) return;
        camera.getWorldDirection(_forward);
        // canvas px -> panel meters (canvas y down = panel -y); forward on the plan -> rotation in the panel
        const [x, y] = onPanel(camera.position.x, camera.position.z);
        arrow.position.set(x, y, 0.002);
        arrow.rotation.z = Math.atan2(-_forward.x, -_forward.z);
    });

    return (
        <group {...groupProps}>
            {/* raycast disabled: the panel must not block rays aimed at the buttons or the scene */}
            <mesh raycast={noRaycast}>
                <planeGeometry args={[MAP_SIZE_M, MAP_SIZE_M]} />
                <meshBasicMaterial map={texture} transparent toneMapped={false} />
            </mesh>
            <group ref={othersRef}>
                {Array.from({ length: MAX_OTHERS }, (_, i) => (
                    <group key={i} visible={false}>
                        <mesh raycast={noRaycast}>
                            <circleGeometry args={[DOT, 16]} />
                            <meshBasicMaterial toneMapped={false} />
                        </mesh>
                        <mesh raycast={noRaycast} position={[0, DOT * 1.6, 0]}>
                            <planeGeometry args={[DOT * 0.5, DOT * 1.6]} />
                            <meshBasicMaterial toneMapped={false} />
                        </mesh>
                    </group>
                ))}
            </group>
            {/* a narrow triangle pointing up (+y) at rotation 0 = looking towards -Z, the map's "up" */}
            <mesh ref={arrowRef} raycast={noRaycast} scale-x={0.7}>
                <circleGeometry args={[ARROW, 3, Math.PI / 2]} />
                <meshBasicMaterial color="#ff9a1a" toneMapped={false} />
            </mesh>
        </group>
    );
}
