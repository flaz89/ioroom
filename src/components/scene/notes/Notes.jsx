import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import { useStore } from '../../../store/appStore';
import { useCanvasTexture } from '../xr-ui/useCanvasTexture';
import { setCursorHover } from '../sceneCursor';

/*
* Post-it notes in the scene (data and rules: store/slices/notesSlice.js).
* - BoardNotes (inside the Board): notes stuck on room surfaces, plus the placing mode (desktop/mobile:
*   NotePlacer, press on the canvas; XR: XRNotePlacer, controller trigger / hand pinch with the ray).
* - NotePin: one note, a square HUD card in its author's color just off the surface (three canvas-drawn
*   layers: a glass card tinted with the author's color with the "NOTE" title and decorative text lines,
*   glowing corner brackets that breathe, a scan line sweeping down the card; the note text is never
*   drawn on it: the card is a static texture per color) with an always visible HUD tag (leader line from the
*   card corner + author's name); hover enlarges it and speeds it up; click / finger touch opens the
*   editor (ui/note-modal/ on desktop, xr-ui/VRNotePanel.jsx in XR).
*   Notes stuck on an object are rendered by SingleObject.jsx inside the object, so they follow it.
* Calibration knobs in board meters (real size at 1:1, scaled down with the tabletop model).
*/
const MARKER_SIZE = 0.22;          // side of the square card
const MARKER_OFFSET = 0.004;       // distance of the first layer from the surface (no z-fighting)
const LAYER_GAP = 0.001;           // distance between the marker layers
const BRACKET_PULSE = 0.035;       // corner brackets "breathing" amplitude (fraction of the card size)
const SCAN_PERIOD = 2.6;           // seconds for the scan line to sweep the card
const HOVER_SPEED = 2.5;           // animation speed multiplier while hovered
const HOVER_SCALE = 1.12;          // marker scale while hovered
const TEXTURE_PIXELS = 256;        // canvas resolution of the card and brackets layers
const CARD_LINES = 7;              // decorative text lines drawn on the card
const TAG_SIZE = [0.88, 0.22];     // author tag sprite [width, height] (same 4:1 aspect as TAG_PIXELS)
const TAG_PIXELS = [512, 128];     // canvas resolution of the tag
const TABLETOP_BOOST = 2;          // notes this much bigger on the tabletop model (easier to aim at with a ray)
const NOTE_USER_DATA = { isNote: true }; // skipped by placing and by surfaceDrag.js (never a support)

const _forward = new THREE.Vector3(0, 0, 1); // planeGeometry faces +Z
const _ndc = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();
const _normal = new THREE.Vector3();
const _boardQuaternion = new THREE.Quaternion();
const _rayMatrix = new THREE.Matrix4();
const noRaycast = () => {};
const TAU = Math.PI * 2;

export default function BoardNotes() {
    const anchorRef = useRef(); // child of the board: its parent is the board root
    const items = useStore((state) => state.notes.items);
    const isXR = useXR((state) => state.mode != null);

    return (
        <group ref={anchorRef}>
            {isXR ? <XRNotePlacer anchorRef={anchorRef} /> : <NotePlacer anchorRef={anchorRef} />}
            {items.map((note) => note.objectId == null && <NotePin key={note.id} note={note} />)}
        </group>
    );
}

/*
* One note. `objectScale`: scale of the object it is stuck on (the note sits inside the object's
* scaled group): undone here, so the paper keeps its real size and squares up on stretched objects.
*/
export function NotePin({ note, objectScale }) {
    const [isHovered, setIsHovered] = useState(false);
    const openNote = useStore((state) => state.openNote);
    // tabletop exists only in XR sessions (back to 'life' when they end)
    const boost = useStore((state) => state.view.mode === 'tabletop') ? TABLETOP_BOOST : 1;

    const { scale, quaternion } = useMemo(() => {
        const s = objectScale ?? [1, 1, 1];
        // geometry normal -> normal of the scaled surface (normals scale by the inverse)
        const normal = new THREE.Vector3(note.n[0] / s[0], note.n[1] / s[1], note.n[2] / s[2]).normalize();
        return {
            scale: [boost / s[0], boost / s[1], boost / s[2]],
            quaternion: new THREE.Quaternion().setFromUnitVectors(_forward, normal)
        };
    }, [note.n, objectScale, boost]);

    // Mouse cursor: hand while hovered (sceneCursor.js); cleared when the note goes away
    useEffect(() => {
        setCursorHover(`note:${note.id}`, isHovered);
        return () => setCursorHover(`note:${note.id}`, false);
    }, [note.id, isHovered]);

    // opens the editor: DOM modal on desktop/mobile (ui/note-modal/), VRNotePanel in XR
    const handleClick = (event) => {
        event.stopPropagation();
        openNote(note.id);
    };

    return (
        <group position={note.p} scale={scale}>
            {/* turned onto the surface; the marker stands off it along its local +Z (= the normal) */}
            <group quaternion={quaternion}>
                <NoteMarker
                    color={note.author.color}
                    phase={note.id.charCodeAt(0)}
                    isHovered={isHovered}
                    onClick={handleClick}
                    onPointerEnter={() => setIsHovered(true)}
                    onPointerLeave={() => setIsHovered(false)}
                />
                {/* tag anchored on the card's upper right corner, always facing the viewer */}
                <NoteTag
                    name={note.author.name}
                    color={note.author.color}
                    position={[MARKER_SIZE * 0.48, MARKER_SIZE * 0.48, MARKER_OFFSET + 3 * LAYER_GAP]}
                />
            </group>
        </group>
    );
}

/*
* Square HUD card, in the XY plane facing +Z (WebGL and WebGPU: built-in materials only):
* - card (catches the pointer): glass tinted with the author's color, bright outline, "NOTE" title,
*   decorative text lines (a reference, not the note's text: one static texture per color);
* - corner brackets: glowing, breathing outwards;
* - scan line: a soft bar of the author's color sweeping down the card.
* `phase` desyncs the animation of different notes.
*
* TOUCH (XR): a fingertip pressing the card also touches the wall right behind it (pmndrs sphere
* pointers measure the distance to bounding boxes, a near-tie). pointerEventsOrder 1 makes the card win,
* so the touch reaches it (same trick as the gizmo in SingleObject.jsx; for the fingertip pointer the
* order is applied by the custom sort in xr/xrStore.js, pmndrs' sphere pointers ignore it otherwise).
*/
function NoteMarker({ color, phase, isHovered, ...pointerHandlers }) {
    const rootRef = useRef();
    const bracketsRef = useRef();
    const scanRef = useRef();
    const timeRef = useRef(phase); // animation clock, runs faster while hovered
    const card = useCanvasTexture(TEXTURE_PIXELS, TEXTURE_PIXELS, (ctx, w) => drawCard(ctx, w, color), [color]);
    const brackets = useCanvasTexture(TEXTURE_PIXELS, TEXTURE_PIXELS, (ctx, w) => drawBrackets(ctx, w, color), [color]);
    const scan = useCanvasTexture(TEXTURE_PIXELS, 16, (ctx, w, h) => drawScanLine(ctx, w, h, color), [color]);

    useFrame((_state, delta) => {
        const time = (timeRef.current += delta * (isHovered ? HOVER_SPEED : 1));
        bracketsRef.current.scale.setScalar(1 + BRACKET_PULSE * (0.5 + 0.5 * Math.sin(time * 2.4)));
        // scan line: top to bottom of the content area, fading in and out at the ends
        const progress = (time / SCAN_PERIOD) % 1;
        scanRef.current.position.y = MARKER_SIZE * (0.22 - 0.62 * progress);
        scanRef.current.material.opacity = Math.sin(progress * Math.PI);
        rootRef.current.scale.setScalar(THREE.MathUtils.damp(rootRef.current.scale.x, isHovered ? HOVER_SCALE : 1, 12, delta));
    });

    return (
        <group ref={rootRef}>
            <mesh position={[0, 0, MARKER_OFFSET]} userData={NOTE_USER_DATA} renderOrder={1} pointerEventsOrder={1} {...pointerHandlers}>
                <planeGeometry args={[MARKER_SIZE, MARKER_SIZE]} />
                <MarkerMaterial map={card} />
            </mesh>
            <mesh ref={scanRef} position={[0, 0, MARKER_OFFSET + LAYER_GAP]} raycast={noRaycast} renderOrder={2}>
                <planeGeometry args={[MARKER_SIZE * 0.84, MARKER_SIZE * 0.06]} />
                <MarkerMaterial map={scan} />
            </mesh>
            <mesh ref={bracketsRef} position={[0, 0, MARKER_OFFSET + 2 * LAYER_GAP]} raycast={noRaycast} renderOrder={3}>
                <planeGeometry args={[MARKER_SIZE, MARKER_SIZE]} />
                <MarkerMaterial map={brackets} />
            </mesh>
        </group>
    );
}

// Unlit, glowing look; no depth write so the stacked layers never cut each other
function MarkerMaterial({ map }) {
    return <meshBasicMaterial map={map} transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />;
}

// Rounded rectangle path (canvas)
function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
}

// Card: glassmorphism in the author's color (translucent tint, light sheen from the top left, bright
// outline), "NOTE" title and decorative dashed text lines like a HUD readout
function drawCard(ctx, size, color) {
    const inset = size * 0.07;
    const inner = size - inset * 2;
    roundedRect(ctx, inset, inset, inner, inner, size * 0.1);
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = color;
    ctx.fill();
    const sheen = ctx.createLinearGradient(inset, inset, size - inset, size - inset);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
    sheen.addColorStop(0.55, 'rgba(255, 255, 255, 0.06)');
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = sheen;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.stroke();
    // title
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${size * 0.1}px "SUSE Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NOTE', size / 2, inset + size * 0.11);
    // decorative lines: two dashes of pseudo-random length per line
    const left = inset + size * 0.08;
    const width = inner - size * 0.16;
    const top = inset + size * 0.22;
    const lineHeight = (inner - size * 0.3) / CARD_LINES;
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < CARD_LINES; i++) {
        const y = top + lineHeight * (i + 0.5);
        const split = width * (0.3 + 0.4 * ((i * 37) % 10) / 10);
        ctx.fillRect(left, y - 3, split - 10, 6);
        ctx.fillRect(left + split, y - 3, (width - split) * (0.5 + 0.5 * ((i * 53) % 7) / 7), 6);
    }
    ctx.globalAlpha = 1;
}

// Corner brackets: thick glowing L shapes with rounded corners
function drawBrackets(ctx, size, color) {
    const inset = size * 0.05;
    const arm = size * 0.2;
    const radius = size * 0.1;
    ctx.lineWidth = size * 0.035;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 0.05;
    const corners = [[inset, inset, 1, 1], [size - inset, inset, -1, 1], [inset, size - inset, 1, -1], [size - inset, size - inset, -1, -1]];
    for (const [x, y, dx, dy] of corners) {
        ctx.beginPath();
        ctx.moveTo(x, y + dy * arm);
        ctx.arcTo(x, y, x + dx * radius, y, radius);
        ctx.lineTo(x + dx * arm, y);
        ctx.stroke();
    }
}

// Scan line: horizontal bar of the author's color, bright in the middle, fading to the sides
function drawScanLine(ctx, width, height, color) {
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.5, color);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, height * 0.35, width, height * 0.3);
}

/*
* Author tag in HUD style: a sprite anchored at its bottom left corner (= `position`, the marker edge),
* drawn as a leader line rising from there + a dark bar with a colored accent and the name in capitals.
* Drawn like a game HUD waypoint: no depth test, so the camera-facing sprite never cuts into the wall it
* stands on (and stays readable behind objects). renderOrder -2: first among the transparent things, so
* in-VR panels, menus and the markers themselves draw over it.
*/
function NoteTag({ name, color, position }) {
    const texture = useCanvasTexture(TAG_PIXELS[0], TAG_PIXELS[1], (ctx, w, h) => drawTag(ctx, w, h, name, color), [name, color]);
    return (
        <sprite position={position} center={[0, 0]} scale={[TAG_SIZE[0], TAG_SIZE[1], 1]} raycast={noRaycast} renderOrder={-2}>
            <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} toneMapped={false} />
        </sprite>
    );
}

function drawTag(ctx, w, h, name, color) {
    const bar = { x: h * 0.5, y: h * 0.12, height: h * 0.5 };
    // name: capitals, shrunk to fit the canvas; the bar is only as wide as the name needs
    const text = name.toUpperCase();
    const padding = { left: 22, right: 26 };
    const maxWidth = w - 6 - bar.x - padding.left - padding.right;
    const size = bar.height * 0.6;
    ctx.font = `700 ${size}px "SUSE Mono", monospace`;
    const measured = ctx.measureText(text).width;
    if (measured > maxWidth) ctx.font = `700 ${size * maxWidth / measured}px "SUSE Mono", monospace`;
    const right = bar.x + padding.left + Math.min(measured, maxWidth) + padding.right;
    // leader: anchor dot, diagonal up, short horizontal into the bar
    ctx.beginPath();
    ctx.arc(6, h - 6, 5, 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(6, h - 6);
    ctx.lineTo(bar.x - 14, bar.y + bar.height / 2);
    ctx.lineTo(bar.x, bar.y + bar.height / 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();
    // bar: dark glass, colored outline, solid accent on the left, clipped top right corner
    const cut = bar.height * 0.35;
    ctx.beginPath();
    ctx.moveTo(bar.x, bar.y);
    ctx.lineTo(right - cut, bar.y);
    ctx.lineTo(right, bar.y + cut);
    ctx.lineTo(right, bar.y + bar.height);
    ctx.lineTo(bar.x, bar.y + bar.height);
    ctx.closePath();
    ctx.fillStyle = 'rgba(10, 16, 32, 0.8)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(bar.x, bar.y, 10, bar.height);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bar.x + 22, bar.y + bar.height / 2 + 2);
}

/*
* Desktop/mobile placing mode (toolbar post-it button): the next press on a room surface or an object
* opens a new note there. The press is taken before the scene sees it (capture on window), so it never
* selects, grabs or orbits; a press on nothing keeps the mode on. Esc leaves the mode.
*/
function NotePlacer({ anchorRef }) {
    const gl = useThree((state) => state.gl);
    const camera = useThree((state) => state.camera);
    const isPlacing = useStore((state) => state.notes.placing);

    useEffect(() => {
        if (!isPlacing) return;
        const element = gl.domElement;
        const { setPlacingNote, openNoteDraft } = useStore.getState();
        const press = (event) => {
            if (event.target !== element) return;
            event.stopImmediatePropagation();
            event.preventDefault();
            const rect = element.getBoundingClientRect();
            _ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
            _raycaster.setFromCamera(_ndc, camera);
            const anchor = noteAnchor(_raycaster, anchorRef.current?.parent);
            if (anchor != null) openNoteDraft(anchor);
        };
        const key = (event) => { if (event.key === 'Escape') setPlacingNote(false); };
        window.addEventListener('pointerdown', press, true);
        window.addEventListener('keydown', key);
        document.body.classList.add('placing-note'); // crosshair cursor on the canvas (app.css)
        return () => {
            window.removeEventListener('pointerdown', press, true);
            window.removeEventListener('keydown', key);
            document.body.classList.remove('placing-note');
        };
    }, [isPlacing, gl, camera, anchorRef]);

    return null;
}

/*
* XR placing mode (wrist menu post-it button): the next "select" (controller trigger, hand pinch) aims
* the input's target ray at a room surface or an object and opens a new note there (VRNotePanel.jsx).
* Read from the session's select event, not from pmndrs pointer events: objects own their pointer
* events (Handle); grabs are off while placing (SingleObject.jsx). Selects while the wrist menu is shown
* are ignored: that is the controller ray pressing a menu button (e.g. the post-it button to cancel).
* The pmndrs ray cursor already shows where the note will go. A select on nothing keeps the mode on.
*/
function XRNotePlacer({ anchorRef }) {
    const session = useXR((state) => state.session);
    const gl = useThree((state) => state.gl);
    const isPlacing = useStore((state) => state.notes.placing);

    useEffect(() => {
        if (!isPlacing || session == null) return;
        const select = (event) => {
            const { view, openNoteDraft } = useStore.getState();
            if (view.handMenuVisible) return;
            // reference space = world space (no XROrigin offset in this app, see RemoteAvatars.jsx)
            const pose = event.frame.getPose(event.inputSource.targetRaySpace, gl.xr.getReferenceSpace());
            if (pose == null) return;
            _rayMatrix.fromArray(pose.transform.matrix);
            _raycaster.ray.origin.setFromMatrixPosition(_rayMatrix);
            _raycaster.ray.direction.set(0, 0, -1).transformDirection(_rayMatrix); // target rays point along -Z
            const anchor = noteAnchor(_raycaster, anchorRef.current?.parent);
            if (anchor != null) openNoteDraft(anchor);
        };
        session.addEventListener('select', select);
        return () => session.removeEventListener('select', select);
    }, [isPlacing, session, gl, anchorRef]);

    return null;
}

/*
* Where a note would stick along `raycaster`: the first visible object mesh (userData.objectId, see
* SingleObject.jsx) or room surface (inside the group marked userData.isRoom, see Room.jsx).
* Gizmo handles, notes and helpers are looked through. Returns { objectId, p, n } (notesSlice.js) or null.
*/
function noteAnchor(raycaster, board) {
    if (board == null) return null;
    for (const hit of raycaster.intersectObject(board, true)) {
        const object = hit.object;
        if (!object.isMesh || hit.face == null || !object.visible || object.isLineSegments2 || object.userData.isNote) continue;
        const objectId = object.userData.objectId;
        if (objectId != null) {
            // object local (= geometry) space: the mesh has no transform of its own
            return { objectId, p: object.worldToLocal(hit.point).toArray(), n: hit.face.normal.toArray() };
        }
        if (isInRoom(object)) {
            board.getWorldQuaternion(_boardQuaternion).invert();
            _normal.copy(hit.face.normal).transformDirection(object.matrixWorld).applyQuaternion(_boardQuaternion);
            return { objectId: null, p: board.worldToLocal(hit.point).toArray(), n: _normal.toArray() };
        }
    }
    return null;
}

function isInRoom(object) {
    for (let o = object; o != null; o = o.parent) if (o.userData.isRoom) return true;
    return false;
}
