import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import { useStore } from '../../../store/appStore';
import { preloadMaterialTextures, useMaterialList } from '../../../materials/library';
import { MATERIAL_CATEGORIES, kindsIn, visibleMaterials } from '../../../materials/grouping';
import { drawPanel, useCanvasTexture } from './useCanvasTexture';
import VRButton from './VRButton';
import VRGrabBar from './VRGrabBar';
import VRMaterialCard, { CARD_WIDTH } from './VRMaterialCard';
import { PointerFilterContext, acceptsPanelPointer } from './pointers';
import { VR_PANEL, placeInFrontOfUser } from './layout';

/*
* In-VR materials panel (store openPanel 'materials', opened from the wrist menu): the material library
* as shaded balls, like the desktop panel (components/ui/materials-panel/MaterialsPanel.jsx), with the same
* organization (materials/grouping.js, filter shared through the store): category tabs (Floors / Walls),
* kind chips (All, Wood, Marble... only the kinds present), and pages of PAGE_SIZE balls with < > when a
* group has more. Plain is the first ball of every tab.
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
const PAGE_ROWS = 3;         // ball rows per page
const PAGE_SIZE = COLUMNS * PAGE_ROWS;
const ROW = 0.034;           // meters: tabs / chips / pager rows
const CHIP_W = 0.062;        // meters (4 chips per row)
const TAB_W = 0.084;          // 3 tabs fit the panel (short labels: grouping.js `short`)
const CELL_W = 0.065;        // meters
const CELL_H = 0.075;        // meters (ball + name)
const BALL = 0.046;          // meters (diameter)
const PAD = 0.02;
const TITLE_H = 0.04;
const WIDTH = COLUMNS * CELL_W + PAD * 2;
const PIXELS_PER_METER = 4000;
const GRID_PIXELS_PER_METER = 2500; // the balls grid: ~650 px wide, enough at arm's length, 40% of the upload
const THUMB_PIXELS = 128;    // thumbnails of the color maps
const ACTIVE = '#ff9628'; // dragged ball ring
const CARD_OPEN_MS = 1000;   // ray resting on a ball -> its card (VRMaterialCard.jsx)
const CARD_SWITCH_MS = 350;  // card open, resting on another ball -> switch (hand rays jitter across balls)
const CARD_CLOSE_MS = 300;   // after leaving the balls
const HOVER_RING = '#ffffff';

/*
* Small thumbnails of the color maps: id -> ImageBitmap (THUMB_PIXELS square).
* Decoded AND downscaled off the main thread (createImageBitmap with resize), and cached for the session
* (reopening the panel costs nothing). All the pending ones are fetched together and handed over in ONE
* state update, so the grid canvas is redrawn / uploaded once, not once per thumbnail.
*/
const thumbnailCache = new Map(); // url -> Promise<ImageBitmap | null>

function loadThumbnail(url) {
    if (!thumbnailCache.has(url)) {
        thumbnailCache.set(url, fetch(url, { mode: 'cors' })
            .then((response) => response.blob())
            .then((blob) => createImageBitmap(blob, { resizeWidth: THUMB_PIXELS, resizeHeight: THUMB_PIXELS, resizeQuality: 'medium' }))
            .catch(() => null));
    }
    return thumbnailCache.get(url);
}

function useThumbnails(materials) {
    const [thumbnails, setThumbnails] = useState({});
    useEffect(() => {
        let cancelled = false;
        const pending = materials.filter((material) => material.maps != null && thumbnails[material.id] == null);
        if (pending.length === 0) return undefined;
        Promise.all(pending.map((material) => loadThumbnail(material.maps.color))).then((bitmaps) => {
            if (cancelled) return;
            setThumbnails((current) => {
                const next = { ...current };
                pending.forEach((material, index) => { if (bitmaps[index]) next[material.id] = bitmaps[index]; });
                return next;
            });
        });
        return () => { cancelled = true; };
    }, [materials]); // eslint-disable-line react-hooks/exhaustive-deps -- `thumbnails` only skips work already done
    return thumbnails;
}

// One ball: the thumbnail clipped to a disc, shaded like a lit sphere (same look as the desktop css ball)
function drawBall(ctx, x, y, radius, thumbnail, outline, color = '#e6e6e6') {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();
    if (thumbnail) ctx.drawImage(thumbnail, x - radius, y - radius, radius * 2, radius * 2);
    else { ctx.fillStyle = color; ctx.fill(); } // no texture: Plain, or a system finish's color
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
    const library = useMaterialList();
    // the store's array (stable between renders), not `library` (a new array every render)
    const thumbnails = useThumbnails(useStore((state) => state.libraryMaterials));
    const [hovered, setHovered] = useState(null); // index (in the page) of the ball under a pointer
    const filter = useStore((state) => state.libraryFilter);
    const setLibraryFilter = useStore((state) => state.setLibraryFilter);
    const kinds = kindsIn(library, filter.category);
    const kind = kinds.some((k) => k.id === filter.kind) ? filter.kind : null; // emptied chip -> All
    const chips = kinds.length > 0 ? [{ id: null, label: 'All' }, ...kinds] : [];
    const shown = visibleMaterials(library, { category: filter.category, kind });
    // Page of the current group (reset when the group changes: the key below)
    const groupKey = `${filter.category}|${kind}`;
    const [pageState, setPageState] = useState({ groupKey, page: 0 });
    const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    const page = pageState.groupKey === groupKey ? Math.min(pageState.page, pageCount - 1) : 0;
    const setPage = (next) => setPageState({ groupKey, page: (next + pageCount) % pageCount });
    const materials = shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE); // the balls on screen

    // Place once, when it opens: in front of the user, facing the eyes
    useLayoutEffect(() => {
        placeInFrontOfUser(groupRef.current, getThree().camera, DISTANCE, BELOW_EYES);
    }, [getThree]);

    // Rows from the top: title, tabs, chip rows, grid (always PAGE_ROWS tall once a group needs paging,
    // so the panel does not jump between pages), pager
    const chipRows = Math.ceil(chips.length / COLUMNS);
    const rows = pageCount > 1 ? PAGE_ROWS : Math.max(1, Math.ceil(materials.length / COLUMNS));
    const gridW = COLUMNS * CELL_W;
    const gridH = rows * CELL_H;
    const height = TITLE_H + ROW * (1 + chipRows) + gridH + (pageCount > 1 ? ROW : 0) + PAD;
    const top = height / 2;
    const tabsY = top - TITLE_H - ROW / 2;
    const chipY = (index) => top - TITLE_H - ROW * (1.5 + Math.floor(index / COLUMNS));
    const gridTop = top - TITLE_H - ROW * (1 + chipRows);

    const background = useCanvasTexture(Math.round(WIDTH * 2000), Math.round(height * 2000), (ctx, w, h) => drawPanel(ctx, w, h), [height]);
    const title = useCanvasTexture(Math.round(0.2 * PIXELS_PER_METER), Math.round(0.03 * PIXELS_PER_METER), (ctx, w, h) => {
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 ${Math.round(h * 0.6)}px "SUSE Mono", monospace`;
        ctx.textBaseline = 'middle';
        ctx.fillText('Materials', 0, h / 2);
    }, []);
    /*
    * The grid canvas (~1000 px) is redrawn and re-uploaded to the GPU ONLY when the balls on screen or
    * their thumbnails change: a redraw is a visible hitch on the Quest. Hover and drag highlights are
    * separate ring meshes (below), and `materials` (a new array every render) is keyed by its ids.
    */
    const ballsKey = materials.map((material) => material.id).join('|');
    const grid = useCanvasTexture(Math.round(gridW * GRID_PIXELS_PER_METER), Math.round(gridH * GRID_PIXELS_PER_METER), (ctx, w) => {
        const cell = w / COLUMNS; // pixels (cells are CELL_W x CELL_H meters)
        const cellH = cell * (CELL_H / CELL_W);
        const radius = cell * (BALL / CELL_W) / 2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        materials.forEach((material, index) => {
            const x = (index % COLUMNS + 0.5) * cell;
            const y = Math.floor(index / COLUMNS) * cellH + radius + cell * 0.08;
            drawBall(ctx, x, y, radius, thumbnails[material.id], null, material.finish?.color);
            ctx.fillStyle = '#ffffff';
            ctx.font = `500 ${Math.round(cell * 0.13)}px "SUSE Mono", monospace`;
            const fit = (cell * 0.92) / ctx.measureText(material.name).width;
            if (fit < 1) ctx.font = `500 ${Math.round(cell * 0.13 * fit)}px "SUSE Mono", monospace`;
            ctx.fillText(material.name, x, y + radius + cell * 0.13);
        });
    }, [ballsKey, thumbnails, rows]);
    // Center of ball `index` in panel space (same layout as the canvas: cells CELL_W x CELL_H)
    const ballCenter = (index) => [
        -gridW / 2 + (index % COLUMNS + 0.5) * CELL_W,
        gridTop - Math.floor(index / COLUMNS) * CELL_H - BALL / 2 - CELL_W * 0.08,
        0.002
    ];
    const draggedIndex = materials.findIndex((material) => material.id === drag?.materialId);

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
        preloadMaterialTextures(materials[index]);
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
    /*
    * Material card: a pointer resting CARD_OPEN_MS on a ball opens its card beside the panel; moving to
    * another ball switches once it rests there CARD_SWITCH_MS; it closes CARD_CLOSE_MS after leaving the
    * balls, and while dragging. Every hover change restarts the timer, so a jittering hand ray that
    * crosses ball borders never makes the card flip (each flip loaded a texture: no image, stutter).
    */
    const hoveredMaterial = hovered != null ? materials[hovered] : null;
    const hoveredId = hoveredMaterial?.maps != null ? hoveredMaterial.id : null; // Plain: no card
    const [cardId, setCardId] = useState(null);
    const cardOpen = useRef(false);
    useEffect(() => {
        cardOpen.current = cardId != null;
    }, [cardId]);
    useEffect(() => {
        const next = isDragging ? null : hoveredId;
        const delay = next == null ? CARD_CLOSE_MS : cardOpen.current ? CARD_SWITCH_MS : CARD_OPEN_MS;
        const timer = setTimeout(() => setCardId(next), isDragging ? 0 : delay);
        return () => clearTimeout(timer);
    }, [hoveredId, isDragging]);
    const cardMaterial = cardId != null ? library.find((material) => material.id === cardId) : null;

    // Panel closed (or session over) mid-drag: no preview left behind
    useEffect(() => () => useStore.getState().setMaterialDrag(null), []);

    return (
        <PointerFilterContext.Provider value={acceptsPanelPointer}>
        <group ref={groupRef}>
            {/* Background: catches presses so they never reach the scene behind the panel */}
            <mesh position-z={-0.001} renderOrder={-1} userData={VR_PANEL} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                <planeGeometry args={[WIDTH, height]} />
                <meshBasicMaterial map={background} transparent toneMapped={false} />
            </mesh>
            <mesh position={[-WIDTH / 2 + PAD + 0.1, top - TITLE_H / 2 - 0.004, 0.001]} raycast={() => null}>
                <planeGeometry args={[0.2, 0.03]} />
                <meshBasicMaterial map={title} transparent depthWrite={false} toneMapped={false} />
            </mesh>
            <VRButton label="X" size={[0.026, 0.026]} onClick={closePanel} position={[WIDTH / 2 - PAD, top - TITLE_H / 2 - 0.004, 0.001]} />

            {/* Category tabs */}
            {MATERIAL_CATEGORIES.map((category, index) => (
                <VRButton key={category.id} label={category.short ?? category.label} size={[TAB_W, 0.026]} active={filter.category === category.id}
                    onClick={() => setLibraryFilter({ category: category.id })}
                    position={[(index - (MATERIAL_CATEGORIES.length - 1) / 2) * (TAB_W + 0.008), tabsY, 0.001]} />
            ))}
            {/* Kind chips, 4 per row */}
            {chips.map((chip, index) => (
                <VRButton key={chip.id ?? 'all'} label={chip.label} size={[CHIP_W - 0.004, 0.024]} active={kind === chip.id}
                    onClick={() => setLibraryFilter({ kind: chip.id })}
                    position={[(index % COLUMNS - (COLUMNS - 1) / 2) * CELL_W, chipY(index), 0.001]} />
            ))}

            {/* All the balls of the page: one mesh, one texture */}
            <mesh
                position={[0, gridTop - gridH / 2, 0.001]}
                pointerEventsType={acceptsPanelPointer}
                onPointerDown={startDrag}
                onPointerMove={(event) => setHovered(ballAt(event.uv))}
                onPointerLeave={() => setHovered(null)}
                onClick={(event) => event.stopPropagation()}
            >
                <planeGeometry args={[gridW, gridH]} />
                <meshBasicMaterial map={grid} transparent depthWrite={false} toneMapped={false} />
            </mesh>

            {/* Highlights: hovered ball (white ring), dragged ball (orange ring) */}
            {hovered != null && hovered !== draggedIndex && (
                <mesh position={ballCenter(hovered)} raycast={() => null}>
                    <ringGeometry args={[BALL / 2 + 0.0008, BALL / 2 + 0.0025, 48]} />
                    <meshBasicMaterial color={HOVER_RING} transparent opacity={0.8} toneMapped={false} />
                </mesh>
            )}
            {draggedIndex >= 0 && (
                <mesh position={ballCenter(draggedIndex)} raycast={() => null}>
                    <ringGeometry args={[BALL / 2 + 0.0008, BALL / 2 + 0.003, 48]} />
                    <meshBasicMaterial color={ACTIVE} toneMapped={false} />
                </mesh>
            )}

            {/* Material card, to the right of the panel, top-aligned */}
            {cardMaterial?.maps != null && (
                <VRMaterialCard material={cardMaterial} position={[WIDTH / 2 + 0.015 + CARD_WIDTH / 2, top, 0.001]} />
            )}

            {/* Pages: < page/count > */}
            {pageCount > 1 && (
                <group position={[0, gridTop - gridH - ROW / 2, 0.001]}>
                    <VRButton label="<" size={[0.03, 0.026]} onClick={() => setPage(page - 1)} position={[-0.05, 0, 0]} />
                    <VRButton label={`${page + 1}/${pageCount}`} size={[0.05, 0.026]} onClick={() => setPage(page + 1)} />
                    <VRButton label=">" size={[0.03, 0.026]} onClick={() => setPage(page + 1)} position={[0.05, 0, 0]} />
                </group>
            )}
            {/* grab bar: move the panel (and its card) around (Quest-window style) */}
            <VRGrabBar targetRef={groupRef} y={-height / 2 - 0.022} />
        </group>
        </PointerFilterContext.Provider>
    );
}
