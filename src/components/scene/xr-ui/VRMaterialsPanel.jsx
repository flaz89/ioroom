import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import { useStore } from '../../../store/appStore';
import { useMaterialList } from '../../../materials/library';
import { drawPanel, useCanvasTexture } from './useCanvasTexture';
import VRButton from './VRButton';
import { PointerFilterContext, acceptsPanelPointer } from './pointers';
import { placeInFrontOfUser } from './layout';

/*
* In-VR materials panel (store openPanel 'materials', opened from the wrist menu): the material library
* as shaded balls, like the desktop panel (components/ui/materials-panel/MaterialsPanel.jsx).
*
* Drag with the RAY (hand pinch / controller trigger), as on desktop: press on a ball, aim at a floor or
* wall face (it previews the material, orange tint) and release there to apply it. The drag lives in the
* store (`materialDrag` with the pointerId of the ray); Room.jsx follows that pointer over its faces
* (preview) and applies the material on its pointerup. Released anywhere else: nothing changes.
* The fingertip can't start a drag (it can't reach the walls); it still presses X.
*
* Cheap: ALL the balls and names are drawn in ONE canvas texture (one mesh, one draw call), from small
* thumbnails of the color maps (no full textures loaded just to show the list). Which ball was pressed
* comes from the hit uv.
*
* Placement: fixed in the world in front of the user when it opens (like VRSunPanel). Calibration knobs:
* tune on the headset.
*/
const DISTANCE = 0.45;       // meters in front of the eyes (horizontal)
const BELOW_EYES = 0.18;     // meters below the eyes
const COLUMNS = 4;
const CELL_W = 0.065;        // meters
const CELL_H = 0.075;        // meters (ball + name)
const BALL = 0.046;          // meters (diameter)
const PAD = 0.02;
const TITLE_H = 0.04;
const WIDTH = COLUMNS * CELL_W + PAD * 2;
const PIXELS_PER_METER = 4000;
const THUMB_PIXELS = 128;    // thumbnails of the color maps
const ACTIVE = 'rgba(255, 150, 40, 0.95)';

// Small thumbnails of the color maps: id -> canvas (CORS image, so the panel canvas stays usable as a texture)
function useThumbnails(materials) {
    const [thumbnails, setThumbnails] = useState({});
    useEffect(() => {
        let cancelled = false;
        for (const material of materials) {
            if (material.maps == null || thumbnails[material.id] != null) continue;
            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.onload = () => {
                if (cancelled) return;
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = THUMB_PIXELS;
                canvas.getContext('2d').drawImage(image, 0, 0, THUMB_PIXELS, THUMB_PIXELS);
                setThumbnails((current) => ({ ...current, [material.id]: canvas }));
            };
            image.src = material.maps.color;
        }
        return () => { cancelled = true; };
    }, [materials]); // eslint-disable-line react-hooks/exhaustive-deps -- `thumbnails` only skips work already done
    return thumbnails;
}

// One ball: the thumbnail clipped to a disc, shaded like a lit sphere (same look as the desktop css ball)
function drawBall(ctx, x, y, radius, thumbnail, outline) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();
    if (thumbnail) ctx.drawImage(thumbnail, x - radius, y - radius, radius * 2, radius * 2);
    else { ctx.fillStyle = '#e6e6e6'; ctx.fill(); }
    const shade = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.1, x, y, radius);
    shade.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
    shade.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
    ctx.fillStyle = shade;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
    if (outline) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
        ctx.lineWidth = 8;
        ctx.strokeStyle = outline;
        ctx.stroke();
    }
}

export default function VRMaterialsPanel() {
    const groupRef = useRef();
    const getThree = useThree((state) => state.get);
    const session = useXR((state) => state.session);
    const closePanel = useStore((state) => state.closePanel);
    const drag = useStore((state) => state.materialDrag);
    const materials = useMaterialList();
    const thumbnails = useThumbnails(materials);
    const [hovered, setHovered] = useState(null); // index of the ball under a pointer

    // Place once, when it opens: in front of the user, facing the eyes
    useLayoutEffect(() => {
        placeInFrontOfUser(groupRef.current, getThree().camera, DISTANCE, BELOW_EYES);
    }, [getThree]);

    const rows = Math.max(1, Math.ceil(materials.length / COLUMNS));
    const gridW = COLUMNS * CELL_W;
    const gridH = rows * CELL_H;
    const height = TITLE_H + gridH + PAD;
    const top = height / 2;

    const background = useCanvasTexture(Math.round(WIDTH * 2000), Math.round(height * 2000), (ctx, w, h) => drawPanel(ctx, w, h), [height]);
    const title = useCanvasTexture(Math.round(0.2 * PIXELS_PER_METER), Math.round(0.03 * PIXELS_PER_METER), (ctx, w, h) => {
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 ${Math.round(h * 0.6)}px "SUSE Mono", monospace`;
        ctx.textBaseline = 'middle';
        ctx.fillText('Materials', 0, h / 2);
    }, []);
    const grid = useCanvasTexture(Math.round(gridW * PIXELS_PER_METER), Math.round(gridH * PIXELS_PER_METER), (ctx, w) => {
        const cell = w / COLUMNS; // pixels (cells are CELL_W x CELL_H meters)
        const cellH = cell * (CELL_H / CELL_W);
        const radius = cell * (BALL / CELL_W) / 2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        materials.forEach((material, index) => {
            const x = (index % COLUMNS + 0.5) * cell;
            const y = Math.floor(index / COLUMNS) * cellH + radius + cell * 0.08;
            const outline = drag?.materialId === material.id ? ACTIVE : hovered === index ? 'rgba(255, 255, 255, 0.8)' : null;
            drawBall(ctx, x, y, radius, thumbnails[material.id], outline);
            ctx.fillStyle = '#ffffff';
            ctx.font = `500 ${Math.round(cell * 0.13)}px "SUSE Mono", monospace`;
            const fit = (cell * 0.92) / ctx.measureText(material.name).width;
            if (fit < 1) ctx.font = `500 ${Math.round(cell * 0.13 * fit)}px "SUSE Mono", monospace`;
            ctx.fillText(material.name, x, y + radius + cell * 0.13);
        });
    }, [materials, thumbnails, hovered, drag?.materialId]);

    // Ball under a hit on the grid (uv: 0..1 left to right, bottom to top); null between/after the balls
    const ballAt = (uv) => {
        if (uv == null) return null;
        const index = Math.floor((1 - uv.y) * rows) * COLUMNS + Math.min(COLUMNS - 1, Math.floor(uv.x * COLUMNS));
        return index < materials.length ? index : null;
    };

    const startDrag = (event) => {
        event.stopPropagation();
        if (event.pointerType !== 'ray') return; // only a ray can then reach the walls
        const index = ballAt(event.uv);
        if (index == null) return;
        useStore.getState().setMaterialDrag({ materialId: materials[index].id, surfaceId: null, pointerId: event.pointerId });
    };

    /*
    * End of the drag: the trigger/pinch is released (session selectend). Room.jsx applies the material on
    * its own pointerup (same release); the drag is cleared just after, so that pointerup always sees it.
    */
    const isDragging = drag?.pointerId != null;
    useEffect(() => {
        if (session == null || !isDragging) return;
        let timer;
        const end = () => { timer = setTimeout(() => useStore.getState().setMaterialDrag(null), 0); };
        session.addEventListener('selectend', end);
        return () => {
            session.removeEventListener('selectend', end);
            clearTimeout(timer);
        };
    }, [session, isDragging]);
    // Panel closed (or session over) mid-drag: no preview left behind
    useEffect(() => () => useStore.getState().setMaterialDrag(null), []);

    return (
        <PointerFilterContext.Provider value={acceptsPanelPointer}>
        <group ref={groupRef}>
            {/* Background: catches presses so they never reach the scene behind the panel */}
            <mesh position-z={-0.001} renderOrder={-1} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                <planeGeometry args={[WIDTH, height]} />
                <meshBasicMaterial map={background} transparent toneMapped={false} />
            </mesh>
            <mesh position={[-WIDTH / 2 + PAD + 0.1, top - TITLE_H / 2 - 0.004, 0.001]} raycast={() => null}>
                <planeGeometry args={[0.2, 0.03]} />
                <meshBasicMaterial map={title} transparent depthWrite={false} toneMapped={false} />
            </mesh>
            <VRButton label="X" size={[0.026, 0.026]} onClick={closePanel} position={[WIDTH / 2 - PAD, top - TITLE_H / 2 - 0.004, 0.001]} />

            {/* All the balls: one mesh, one texture */}
            <mesh
                position={[0, top - TITLE_H - gridH / 2, 0.001]}
                pointerEventsType={acceptsPanelPointer}
                onPointerDown={startDrag}
                onPointerMove={(event) => setHovered(ballAt(event.uv))}
                onPointerLeave={() => setHovered(null)}
                onClick={(event) => event.stopPropagation()}
            >
                <planeGeometry args={[gridW, gridH]} />
                <meshBasicMaterial map={grid} transparent depthWrite={false} toneMapped={false} />
            </mesh>
        </group>
        </PointerFilterContext.Provider>
    );
}
