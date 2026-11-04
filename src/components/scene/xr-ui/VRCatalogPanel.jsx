import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import { Box3, MeshStandardMaterial, Vector3 } from 'three';
import { useStore } from '../../../store/appStore';
import { SHAPE_LIFT, objectsList } from '../../../store/slices/objectsSlice';
import { SHAPES, categoriesWith, modelsIn, subtypesIn } from '../../../models/grouping';
import { modelFileUrl } from '../../../models/modelsApi';
import { useModelMesh } from '../../../models/useModelMesh';
import { shapeOf } from '../level/shapeGeometry';
import { spawnPoint } from '../../../models/spawnPoint';
import { activeLevel } from '../../../plan/planModel';
import CategoryIcon, { ShapeIcon } from '../../ui/catalog-menu/categoryIcons';
import { drawPanel, loadThumbnail, useCanvasTexture } from './useCanvasTexture';
import { loadSvgImage } from './buttonFace';
import VRButton from './VRButton';
import VRGrabBar from './VRGrabBar';
import { PointerFilterContext, acceptsPanelPointer } from './pointers';
import { VR_PANEL, placeInFrontOfUser } from './layout';

/*
* In-VR "+" catalog (store openPanel 'objects', wrist "+"; plan U6), in first person and in tabletop: the
* desktop menu's levels (ui/catalog-menu/CatalogMenu.jsx, models/grouping.js). Level 1 = category tiles
* (symbol, name, count; Basic shapes last); level 2 = subtype chips + model tiles (thumbnail, name, "Fixed")
* in pages of PAGE_SIZE with < >, and back. A click on a model adds it with its first variant (the variant
* changes later on the piece itself); a basic shape adds that primitive.
* Where it goes: first person = on the floor SPAWN_DISTANCE in front of the user (spawnPoint: a drawn floor
* outside the walls, else the plan center); tabletop = the plan center (the board's middle).
* Cheap like the materials panel: all the tiles of a page in ONE canvas (one draw call), redrawn only when
* the tiles or their images change; hover = a separate ring; the pressed tile comes from the hit uv.
* MINIATURE: the ray resting PREVIEW_MS on a model or basic shape tile makes a tiny copy pop out of it, slowly
* turning on itself (TilePreview). Pinch / trigger on such a tile = DRAG: the store's modelDrag follows that ray
* over the floors (Room.jsx onModelDragMove) with a full-size hologram (level/ModelDragGhost.jsx); releasing
* (session selectend) adds it there, selected. Back over the panel = no landing point (the release is then a
* plain click: added in front of the user as before).
* ponytail: no manufacturers screen and no search in VR yet (few models); add them like the desktop menu.
*/
const DISTANCE = 0.45;       // meters in front of the eyes (horizontal)
const BELOW_EYES = 0.18;     // meters below the eyes
const SPAWN_DISTANCE = 1.2;  // meters in front of the user (first person)
const COLUMNS = 4;
const PAGE_ROWS = 3;
const PAGE_SIZE = COLUMNS * PAGE_ROWS;
const ROW = 0.034;
const CELL_W = 0.065;
const CELL_H = 0.075;
const PAD = 0.02;
const TITLE_H = 0.04;
const WIDTH = COLUMNS * CELL_W + PAD * 2;
const PIXELS_PER_METER = 4000;
const GRID_PIXELS_PER_METER = 2500;
const PREVIEW_MS = 300;      // ray resting on a model tile -> its miniature pops out (hand rays jitter)
const PREVIEW_SIZE = 0.07;   // meters, longest side of the miniature
const PREVIEW_OUT = 0.045;   // meters in front of the tile
const PREVIEW_SPIN = 0.5;    // rad/s (1.2 felt too fast on the Quest)
const PREVIEW_POP = 12;      // 1/s, exponential growth towards its size

// Symbols as canvas images (white strokes): one element per id, so loadSvgImage caches them
const symbols = new Map();
const symbolOf = (key, element) => {
    if (!symbols.has(key)) symbols.set(key, element);
    return symbols.get(key);
};

// One tile: image (symbol or thumbnail on a light card), name below, optional badge top right
function drawTile(ctx, x, y, w, h, { image, isThumb, name, badge }) {
    ctx.save();
    ctx.translate(x, y);
    drawPanel(ctx, w * 0.94, h * 0.94, 'rgba(0, 0, 0, 0.25)');
    const size = w * 0.62;
    const ix = (w * 0.94 - size) / 2, iy = h * 0.08;
    if (isThumb) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillRect(ix, iy, size, size);
    }
    if (image) ctx.drawImage(image, ix, iy, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const font = (px) => `500 ${Math.round(px)}px "SUSE Mono", monospace`;
    ctx.font = font(w * 0.12);
    const fit = (w * 0.88) / ctx.measureText(name).width;
    if (fit < 1) ctx.font = font(w * 0.12 * fit);
    ctx.fillText(name, w * 0.47, iy + size + h * 0.1);
    if (badge) {
        ctx.font = font(w * 0.1);
        const bw = ctx.measureText(badge).width + w * 0.08;
        ctx.fillStyle = 'rgba(16, 20, 48, 0.85)';
        ctx.fillRect(w * 0.9 - bw, h * 0.03, bw, w * 0.14);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(badge, w * 0.9 - bw / 2, h * 0.03 + w * 0.07);
    }
    ctx.restore();
}

const _eye = new Vector3();
const _forward = new Vector3();

export default function VRCatalogPanel() {
    const groupRef = useRef();
    const getThree = useThree((state) => state.get);
    const closePanel = useStore((state) => state.closePanel);
    const models = useStore((state) => state.libraryModels);
    const [category, setCategory] = useState(null); // null = categories
    const [subtype, setSubtype] = useState(null);
    const [page, setPage] = useState(0);
    const [hovered, setHovered] = useState(null);
    const session = useXR((state) => state.session);
    const drag = useStore((state) => state.modelDrag);
    const isDragging = drag?.pointerId != null;

    useLayoutEffect(() => {
        placeInFrontOfUser(groupRef.current, getThree().camera, DISTANCE, BELOW_EYES);
    }, [getThree]);

    const open = (id) => { setCategory(id); setSubtype(null); setPage(0); setHovered(null); };

    // The tiles of this level: { key, name, badge?, symbol? | thumb?, pick }
    let tiles;
    if (category == null) {
        tiles = categoriesWith(models).map((item) => ({
            key: item.id, name: item.label, symbol: symbolOf(item.id, <CategoryIcon id={item.id} />),
            badge: item.id === SHAPES ? null : String(modelsIn(models, { category: item.id }).length),
            pick: () => open(item.id)
        }));
    } else if (category === SHAPES) {
        tiles = objectsList.map((item) => ({ key: item.type, name: item.name, symbol: symbolOf(`shape:${item.type}`, <ShapeIcon type={item.type} />), shape: item, pick: () => add({ type: item.type }) }));
    } else {
        tiles = modelsIn(models, { category, subtype }).map((model) => ({
            key: model.id, name: model.name, thumb: modelFileUrl(model.files.thumb), badge: model.fixed ? 'Fixed' : null, model, pick: () => add({ model })
        }));
    }
    const chips = category != null && category !== SHAPES ? subtypesIn(models, category) : [];
    const pageCount = Math.max(1, Math.ceil(tiles.length / PAGE_SIZE));
    const current = Math.min(page, pageCount - 1);
    const shown = tiles.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

    // Adds a model (first variant) or a primitive, in front of the user (first person) or mid-board (tabletop)
    function add({ model, type }) {
        const state = useStore.getState();
        let ground = null;
        if (state.view.mode !== 'tabletop') { // first person: the board is the identity (world = plan meters)
            const camera = getThree().camera;
            camera.getWorldPosition(_eye);
            camera.getWorldDirection(_forward).setY(0);
            if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, -1);
            _forward.normalize();
            ground = [_eye.x + _forward.x * SPAWN_DISTANCE, _eye.z + _forward.z * SPAWN_DISTANCE];
        }
        const point = spawnPoint(activeLevel(state.plan), ground);
        if (model) state.addModel(model, model.variants[0]?.id, point);
        else state.addObject(type, [point[0], point[1] + SHAPE_LIFT, point[2]]);
        closePanel();
    }

    // Images of the tiles on screen, loaded together and handed over in one update (one redraw)
    const tilesKey = shown.map((tile) => tile.key).join('|');
    const [images, setImages] = useState({});
    useEffect(() => {
        let cancelled = false;
        const pending = shown.filter((tile) => images[tile.key] == null);
        if (pending.length === 0) return undefined;
        Promise.all(pending.map((tile) => (tile.thumb ? loadThumbnail(tile.thumb) : loadSvgImage(tile.symbol)))).then((loaded) => {
            if (cancelled) return;
            setImages((before) => {
                const next = { ...before };
                pending.forEach((tile, index) => { if (loaded[index]) next[tile.key] = loaded[index]; });
                return next;
            });
        });
        return () => { cancelled = true; };
    }, [tilesKey]); // eslint-disable-line react-hooks/exhaustive-deps -- `shown` is a new array every render, keyed by tilesKey

    // Layout from the top: title, back + chips row (level 2), grid, pager
    const chipRows = category == null ? 0 : 1 + (chips.length > 0 ? Math.ceil((chips.length + 1) / COLUMNS) : 0); // back + chips with All
    const rows = pageCount > 1 ? PAGE_ROWS : Math.max(1, Math.ceil(shown.length / COLUMNS));
    const gridW = COLUMNS * CELL_W;
    const gridH = rows * CELL_H;
    const height = TITLE_H + ROW * chipRows + gridH + (pageCount > 1 ? ROW : 0) + PAD;
    const top = height / 2;
    const gridTop = top - TITLE_H - ROW * chipRows;
    const chipY = (index) => top - TITLE_H - ROW * (1.5 + Math.floor(index / COLUMNS));

    const background = useCanvasTexture(Math.round(WIDTH * 2000), Math.round(height * 2000), (ctx, w, h) => drawPanel(ctx, w, h), [height]);
    const titleText = category == null ? 'Add' : category === SHAPES ? 'Basic shapes' : categoriesWith(models).find((item) => item.id === category)?.label ?? '';
    const title = useCanvasTexture(Math.round(0.2 * PIXELS_PER_METER), Math.round(0.03 * PIXELS_PER_METER), (ctx, w, h) => {
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 ${Math.round(h * 0.6)}px "SUSE Mono", monospace`;
        ctx.textBaseline = 'middle';
        ctx.fillText(titleText, 0, h / 2);
    }, [titleText]);
    const grid = useCanvasTexture(Math.round(gridW * GRID_PIXELS_PER_METER), Math.round(gridH * GRID_PIXELS_PER_METER), (ctx, w) => {
        const cell = w / COLUMNS;
        const cellH = cell * (CELL_H / CELL_W);
        shown.forEach((tile, index) => drawTile(ctx, (index % COLUMNS) * cell + cell * 0.03, Math.floor(index / COLUMNS) * cellH + cellH * 0.03, cell, cellH, {
            image: images[tile.key], isThumb: tile.thumb != null, name: tile.name, badge: tile.badge
        }));
    }, [tilesKey, images, rows]);

    const tileAt = (uv) => {
        if (uv == null) return null;
        const index = Math.floor((1 - uv.y) * rows) * COLUMNS + Math.min(COLUMNS - 1, Math.floor(uv.x * COLUMNS));
        return index < shown.length ? index : null;
    };
    // Miniature of the model / shape tile the ray rests on (not while dragging)
    const hoveredTile = !isDragging && hovered != null ? shown[hovered] : null;
    const hoveredKey = hoveredTile?.model || hoveredTile?.shape ? hoveredTile.key : null;
    const [preview, setPreview] = useState(null); // { tile, index }
    useEffect(() => {
        const timer = setTimeout(() => setPreview(hoveredKey ? { tile: hoveredTile, index: hovered } : null), hoveredKey ? PREVIEW_MS : 0);
        return () => clearTimeout(timer);
    }, [hoveredKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the tile and index follow its key

    // Drag out of a model tile: only a ray can then reach the floors
    const startDrag = (event) => {
        event.stopPropagation();
        if (event.pointerType !== 'ray') return;
        const tile = shown[tileAt(event.uv)];
        const piece = tile?.model ? { model: tile.model, variantId: tile.model.variants[0]?.id } : tile?.shape ? { type: tile.shape.type } : null;
        if (piece) useStore.getState().setModelDrag({ ...piece, point: null, pointerId: event.pointerId });
    };
    const moveOnGrid = (event) => {
        setHovered(tileAt(event.uv));
        const current = useStore.getState().modelDrag;
        if (current?.point != null && current.pointerId === event.pointerId) useStore.getState().setModelDrag({ ...current, point: null }); // back on the panel
    };
    // Release (selectend): added where the hologram is, if anywhere; after the pointerup / click of that same release
    useEffect(() => {
        if (session == null || !isDragging) return undefined;
        let timer;
        const end = () => { timer = setTimeout(() => useStore.getState().dropModel(), 0); };
        session.addEventListener('selectend', end);
        return () => {
            session.removeEventListener('selectend', end);
            clearTimeout(timer);
        };
    }, [session, isDragging]);
    // Panel closed (or session over) mid-drag: no hologram left behind
    useEffect(() => () => useStore.getState().setModelDrag(null), []);

    const tileCenter = (index) => [-gridW / 2 + (index % COLUMNS + 0.5) * CELL_W, gridTop - (Math.floor(index / COLUMNS) + 0.5) * CELL_H, 0.002];

    return (
        <PointerFilterContext.Provider value={acceptsPanelPointer}>
        <group ref={groupRef}>
            <mesh position-z={-0.001} renderOrder={-1} userData={VR_PANEL} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                <planeGeometry args={[WIDTH, height]} />
                <meshBasicMaterial map={background} transparent toneMapped={false} />
            </mesh>
            <mesh position={[-WIDTH / 2 + PAD + 0.1, top - TITLE_H / 2 - 0.004, 0.001]} raycast={() => null}>
                <planeGeometry args={[0.2, 0.03]} />
                <meshBasicMaterial map={title} transparent depthWrite={false} toneMapped={false} />
            </mesh>
            <VRButton label="X" size={[0.026, 0.026]} onClick={closePanel} position={[WIDTH / 2 - PAD, top - TITLE_H / 2 - 0.004, 0.001]} />

            {/* level 2: back, then the subtype chips (All + the ones present) */}
            {category != null && (
                <VRButton label="< Back" size={[CELL_W * 1.4, 0.024]} onClick={() => open(null)}
                    position={[-gridW / 2 + CELL_W * 0.7, top - TITLE_H - ROW / 2, 0.001]} />
            )}
            {chips.length > 0 && [{ id: null, label: 'All' }, ...chips].map((chip, index) => (
                <VRButton key={chip.id ?? 'all'} label={chip.label} size={[CELL_W - 0.004, 0.024]} active={subtype === chip.id}
                    onClick={() => { setSubtype(chip.id); setPage(0); }}
                    position={[(index % COLUMNS - (COLUMNS - 1) / 2) * CELL_W, chipY(index), 0.001]} />
            ))}

            <mesh
                position={[0, gridTop - gridH / 2, 0.001]}
                pointerEventsType={acceptsPanelPointer}
                onPointerDown={startDrag}
                onPointerMove={moveOnGrid}
                onPointerLeave={() => setHovered(null)}
                onClick={(event) => { event.stopPropagation(); const index = tileAt(event.uv); if (index != null) shown[index].pick(); }}
            >
                <planeGeometry args={[gridW, gridH]} />
                <meshBasicMaterial map={grid} transparent depthWrite={false} toneMapped={false} />
            </mesh>
            {hovered != null && (
                <mesh position={tileCenter(hovered)} raycast={() => null}>
                    <planeGeometry args={[CELL_W * 0.94, CELL_H * 0.94]} />
                    <meshBasicMaterial color="#ff9628" transparent opacity={0.25} depthWrite={false} toneMapped={false} />
                </mesh>
            )}

            {preview != null && shown[preview.index]?.key === preview.tile.key && (preview.tile.model
                ? <ModelPreview key={preview.tile.key} model={preview.tile.model} position={[tileCenter(preview.index)[0], tileCenter(preview.index)[1], PREVIEW_OUT]} />
                : <TilePreview key={preview.tile.key} geometry={shapeOf(preview.tile.shape.geometryType)} material={SHAPE_MATERIAL}
                    stretch={preview.tile.shape.defaultScale} position={[tileCenter(preview.index)[0], tileCenter(preview.index)[1], PREVIEW_OUT]} />
            )}

            {pageCount > 1 && (
                <group position={[0, gridTop - gridH - ROW / 2, 0.001]}>
                    <VRButton label="<" size={[0.03, 0.026]} onClick={() => setPage((current - 1 + pageCount) % pageCount)} position={[-0.05, 0, 0]} />
                    <VRButton label={`${current + 1}/${pageCount}`} size={[0.05, 0.026]} onClick={() => setPage((current + 1) % pageCount)} />
                    <VRButton label=">" size={[0.03, 0.026]} onClick={() => setPage((current + 1) % pageCount)} position={[0.05, 0, 0]} />
                </group>
            )}
            <VRGrabBar targetRef={groupRef} y={-height / 2 - 0.022} />
        </group>
        </PointerFilterContext.Provider>
    );
}

// Tiny copy of a catalog piece or basic shape popping out of its tile and slowly turning on itself
const _box = new Box3();
const _size = new Vector3();
const _center = new Vector3();
const SHAPE_MATERIAL = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 });

// a catalog piece: first variant, placeholder box while it loads
function ModelPreview({ model, position }) {
    const { geometry, materials } = useModelMesh(model, model.variants[0]?.id);
    return <TilePreview geometry={geometry} material={materials} position={position} />;
}

// stretch = the shape's own scale (a cylinder is taller than wide), applied before fitting PREVIEW_SIZE
function TilePreview({ geometry, material, stretch = [1, 1, 1], position }) {
    const groupRef = useRef();
    const fit = useMemo(() => {
        _box.setFromBufferAttribute(geometry.attributes.position);
        _box.min.multiply(_size.fromArray(stretch));
        _box.max.multiply(_size);
        _box.getSize(_size);
        return { scale: PREVIEW_SIZE / Math.max(_size.x, _size.y, _size.z, 1e-3), center: _box.getCenter(_center).negate().toArray() };
    }, [geometry, stretch]);
    useFrame((_, delta) => {
        const group = groupRef.current;
        group.rotation.y += delta * PREVIEW_SPIN;
        group.scale.setScalar(group.scale.x + (fit.scale - group.scale.x) * (1 - Math.exp(-delta * PREVIEW_POP)));
    });
    return (
        <group ref={groupRef} position={position} scale={0.001}>
            <mesh geometry={geometry} material={material} position={fit.center} scale={stretch} raycast={() => null} dispose={null} />
        </group>
    );
}
