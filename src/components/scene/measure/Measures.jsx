import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useXR } from '@react-three/xr';
import { useStore } from '../../../store/appStore';
import { useCanvasTexture } from '../xr-ui/useCanvasTexture';
import { formatLength, lockToAxis, snapPoint, snapToSegments } from './measureSnap';
import { objectMeshes } from '../level/objectMeshes';
import { setCursorGrabbing, setCursorHover } from '../sceneCursor';
import './measures.css';

/*
* RULER (toolbar ruler button on desktop, wrist menu ruler button in VR).
*
* BoardMeasures sits inside the Board: measures are stored and drawn in board space, so they follow the
* tabletop model and their length is always in real meters.
* - Saved measures (shared, author's color) and my local temporary ones (orange) are drawn as a line with
*   end dots and a length label. Line and dots are drawn over everything (depthTest off, like CAD
*   dimensions); label and dots keep a constant size on screen (sprites without size attenuation).
* - Click a label: actions (Save = share with the room, for my temporary measures; Delete).
* - Ruler mode (desktop): move over walls, floor and objects: the point snaps to nearby corners (green) and
*   edges (yellow) of the surface under the pointer, and to the ends (green) / lines (yellow) of the
*   measures already taken (measureSnap.js); click = first point, then a live
*   measure follows the pointer LOCKED to one of the three axes (colored like the axis: X red, vertical
*   blue, Z green; lockToAxis); hold Shift for a free direction. Click again = measure taken (temporary,
*   mine). A press that drags orbits
*   the camera as usual (only a still click places a point). Esc: drop the first point, then leave the mode.
*   Objects are not selected or grabbed while the ruler is on (SingleObject.jsx).
* - MOVING ENDS (desktop): the selected measure (mine or saved: anyone can edit) shows bigger, grabbable end dots;
*   dragging one moves that end with the ruler's snaps, locked to the axis through the other end (Shift =
*   free), anchored on the object it lands on (if any); saved on release (store moveMeasureEnd). The press
*   on a handle never orbits the camera nor places a ruler point (MeasureEndDragger, handleAt).
* - XR (first person, not on the tabletop): same handles on the selected measure; pressing the
*   trigger / pinching while aiming at one (handleUnderRay) drags that end along the ray with the ruler's
*   snaps until release (XRMeasurePlacer). That press is not a ruler point nor a label selection.
* - Label hover (mouse, XR ray): grows to LABEL_HOVER_SCALE like the notes, hand cursor on desktop.
* - Labels are flat cards in 3D lying ALONG the measure line, turned around it to face the eye (never upside
*   down), with a REAL size in board meters like the notes' tags (twice as big on the tabletop,
*   TABLETOP_LABEL_BOOST). A real 3D orientation: stays on the line in VR too, whatever the head does.
* - TABLETOP: labels not clickable, no handles.
* - ANCHORED ENDS: a point taken on an object is stored in the object's local space (measuresSlice.js) and
*   resolved every frame from its live mesh (objectMeshes.js): moving / rotating / scaling the object (also
*   while dragging, also by another device) updates the measure live. The label text re-renders only when
*   the shown value changes.
*/
const LOCAL_COLOR = '#ff9a1a';
const SNAP_COLORS = { vertex: '#3ddc84', edge: '#ffd23f', surface: '#ffffff' };
const AXIS_COLORS = { x: '#ff5252', y: '#4d8dff', z: '#3ddc84' }; // SketchUp-like: red, blue (up), green
const LINE_RADIUS = 0.004;           // meters (board space)
const TABLETOP_BOOST = 6;            // thicker line on the tabletop model (1/12 scale)
const DOT_SIZE = 0.012;              // screen fraction (sprites without size attenuation)
// Label card in BOARD meters (real size, like the notes' author tags): text 45% of the card height
// (drawLabel) = 0.066 m, the same text height as a note tag (Notes.jsx: TAG_SIZE x bar 0.5 x text 0.6);
// 320 x 96 canvas aspect
const LABEL_SIZE = [0.49, 0.147];
const LABEL_HOVER_SCALE = 1.12;    // label scale while hovered (mouse or XR ray), like the notes' markers
const TABLETOP_LABEL_BOOST = 2;   // tabletop: labels this much bigger, like the notes (Notes.jsx TABLETOP_BOOST)
const HANDLE_AIM = 0.04; // XR: a handle is aimed at within this angle (radians, ~2.3°) of the ray
const SNAP_SCREEN = 0.02;            // snap distance = 2% of the camera distance (same feel at any zoom)
const HANDLE_SCALE = 2;              // end dots of an editable measure (grab handles)
const CLICK_SLOP = 5;                // pixels: a press that moves more is an orbit, not a click
const noRaycast = () => null;
/*
* Labels: sprites without size attenuation need the camera to be hit-tested (Raycaster.camera). The
* desktop screen pointer has it; XR rays do not (three would throw): there they are simply not hit yet.
*/
function labelRaycast(raycaster, intersects) {
    if (raycaster.camera != null) THREE.Sprite.prototype.raycast.call(this, raycaster, intersects);
}
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
const labelPlane = new THREE.PlaneGeometry(1, 1);
const _ndc = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();
const _up = new THREE.Vector3(0, 1, 0);
const _boardInverse = new THREE.Matrix4();
const _rayMatrix = new THREE.Matrix4();
const _boardRay = new THREE.Ray();
const _world = new THREE.Vector3();

// A stored end ({ p, objectId?, local? }, or an old plain [x, y, z]) as an end object
const toEnd = (end) => (Array.isArray(end) ? { p: end } : end);

/*
* Position of an end in `space` (a group with the board's frame) into `target`: from the live object mesh
* when anchored on an object that is mounted, else its stored board-space point.
*/
function resolveEnd(end, space, target) {
    const mesh = end.objectId != null ? objectMeshes.get(end.objectId) : null;
    if (mesh != null && end.local != null) {
        mesh.updateWorldMatrix(true, false);
        target.fromArray(end.local);
        mesh.localToWorld(target);
        return space.worldToLocal(target);
    }
    return target.fromArray(end.p);
}

// An end at `point` (board space, array), anchored on `mesh` (an object) when given
function makeEnd(point, mesh, board) {
    if (mesh == null) return { p: point };
    _world.fromArray(point);
    board.localToWorld(_world);
    return { p: point, objectId: mesh.userData.objectId, local: mesh.worldToLocal(_world).toArray() };
}

export default function BoardMeasures() {
    const rootRef = useRef(); // child of the board, identity: its parent is the board root
    const { items, local, selectedId } = useStore((state) => state.measures);
    const [draft, setDraft] = useState(null); // { id, which, end, kind } while an end is dragged (desktop)
    // 2D plan open: its own actions and handles (builder/PlanMeasures.jsx)
    const isPlanView = useStore((state) => state.workspace === 'builder' && state.builderView === '2d');
    const isXR = useXR((state) => state.mode != null);
    const isTabletop = useStore((state) => state.view.mode === 'tabletop');
    const boost = isTabletop ? TABLETOP_BOOST : 1;
    // handles: desktop 3D view, and XR in first person (on the tabletop the ends are too small to aim at)
    const canEdit = isXR ? !isTabletop : !isPlanView;

    return (
        <group ref={rootRef}>
            {isXR ? <XRMeasurePlacer rootRef={rootRef} boost={boost} onDraft={setDraft} /> : <MeasurePlacer rootRef={rootRef} boost={boost} />}
            {!isXR && !isPlanView && <MeasureEndDragger rootRef={rootRef} onDraft={setDraft} />}
            {draft && <Dot position={draft.end.p} color={SNAP_COLORS[draft.kind] ?? SNAP_COLORS.surface} scale={1.4} />}
            {items.map((measure) => (
                <MeasureLine key={measure.id} measure={draft?.id === measure.id ? { ...measure, [draft.which]: draft.end } : measure}
                    color={measure.author?.color ?? LOCAL_COLOR} boost={boost}
                    selected={selectedId === measure.id} saved editable={selectedId === measure.id && canEdit} />
            ))}
            {local.map((measure) => (
                <MeasureLine key={measure.id} measure={draft?.id === measure.id ? { ...measure, [draft.which]: draft.end } : measure}
                    color={LOCAL_COLOR} boost={boost} selected={selectedId === measure.id} editable={selectedId === measure.id && canEdit} />
            ))}
        </group>
    );
}

/*
* What a ruler ray hits first among walls / floor (inside userData.isRoom) and objects (userData.objectId),
* or a measure label (userData.measureId). Notes, outlines, gizmos and helpers are looked through.
* Returns { measureId } | { point (board space, array), kind, mesh (the object hit, or null),
* normal (of the surface hit, board space, Vector3) } | null.
*/
function rulerHit(raycaster, board, camera) {
    for (const hit of raycaster.intersectObject(board, true)) {
        const object = hit.object;
        if (object.userData.measureId != null) return { measureId: object.userData.measureId };
        if (!object.isMesh || hit.face == null || !object.visible || object.userData.isNote) continue;
        if (object.userData.objectId == null && !isInRoom(object)) continue;
        const threshold = SNAP_SCREEN * camera.getWorldPosition(new THREE.Vector3()).distanceTo(hit.point);
        const snap = snapPoint(object, hit.point, threshold);
        const normal = hit.face.normal.clone().transformDirection(object.matrixWorld)
            .transformDirection(_boardInverse.copy(board.matrixWorld).invert());
        return { point: board.worldToLocal(snap.point).toArray(), kind: snap.kind, mesh: object.userData.objectId != null ? object : null, normal };
    }
    return null;
}

/*
* The point a ruler ray gives (desktop pointer or XR target ray): a label to select ({ measureId }), or
* { end, kind, axis? } (end anchored on the object under the ray, if any). After the first point the
* measure is locked to the axis through it closest to the ray (lockToAxis), unless `free`; a locked
* point is anchored on an object only when it comes from a snapped corner / edge of it.
* `root`: group with the board's frame (BoardMeasures' root).
*/
// origin: the end the axis lock starts from (default: the ruler's first point); excludeId: a measure that is
// not a snap target (the one whose end is being dragged)
function rulerPoint(raycaster, board, root, camera, free, origin = useStore.getState().measures.start, excludeId = null) {
    const hit = rulerHit(raycaster, board, camera);
    if (hit?.measureId != null) return hit;
    // the ray in board space (measures and the room's axes live there, also on a rotated tabletop)
    _boardInverse.copy(board.matrixWorld).invert();
    _boardRay.origin.copy(raycaster.ray.origin).applyMatrix4(_boardInverse);
    _boardRay.direction.copy(raycaster.ray.direction).transformDirection(_boardInverse);
    // existing measures first: their ends / lines (often in the air, so tested on the ray)
    const onMeasure = measureSnap(_boardRay, root, excludeId);
    const start = origin;
    if (start == null || free) {
        if (onMeasure) return { end: onMeasure.end, kind: onMeasure.kind };
        return hit && { end: makeEnd(hit.point, hit.mesh, board), kind: hit.kind };
    }
    if (hit == null && onMeasure == null) return null;
    let snapped = null, plane = null, anchor = null, kind = 'surface';
    if (onMeasure) {
        snapped = new THREE.Vector3(...onMeasure.end.p);
        kind = onMeasure.kind;
    } else if (hit.kind === 'vertex' || hit.kind === 'edge') {
        snapped = new THREE.Vector3(...hit.point);
        anchor = hit.mesh;
        kind = hit.kind;
    } else {
        // the surface under the ray: the axis can end where it meets it (e.g. on the opposite wall)
        plane = { point: new THREE.Vector3(...hit.point), normal: hit.normal };
    }
    const lock = lockToAxis(resolveEnd(start, root, new THREE.Vector3()), _boardRay.origin, _boardRay.direction, snapped, plane);
    return { end: makeEnd(lock.point.toArray(), anchor, board), kind, axis: lock.axis };
}

/*
* Snap to the existing measures (mine and saved): an end point (it keeps its anchor on an object, so a
* measure snapped there follows the same object) or a point of a line. Ray in board space.
* Returns { end, kind } or null.
*/
function measureSnap(ray, root, excludeId = null) {
    const { items, local } = useStore.getState().measures;
    const measures = [...items, ...local].filter((measure) => measure.id !== excludeId);
    if (measures.length === 0) return null;
    const ends = measures.map((measure) => [toEnd(measure.a), toEnd(measure.b)]);
    const segments = ends.map(([a, b]) => ({ a: resolveEnd(a, root, new THREE.Vector3()), b: resolveEnd(b, root, new THREE.Vector3()) }));
    const snap = snapToSegments(ray, segments, SNAP_SCREEN);
    if (snap == null) return null;
    const point = snap.point.toArray();
    if (snap.endpoint == null) return { end: { p: point }, kind: 'edge' };
    const source = ends[snap.index][snap.endpoint === 'a' ? 0 : 1];
    return { end: { ...source, p: point }, kind: 'vertex' };
}

/*
* XR: the measure label a ray aims at, or null: the ray passes within half the card's real width (its
* world scale) of its center, whatever the card's turn; the nearest one along the ray wins. Labels are
* drawn over everything, so they win over surfaces.
*/
const _labelScale = new THREE.Vector3();
const _toLabel = new THREE.Vector3(), _labelPosition = new THREE.Vector3(), _eye = new THREE.Vector3();
function labelUnderRay(ray, root, camera) {
    camera.getWorldPosition(_eye);
    let best = null;
    root.traverse((object) => {
        const measureId = object.userData.measureId;
        if (measureId == null) return;
        object.getWorldPosition(_labelPosition);
        _toLabel.subVectors(_labelPosition, ray.origin);
        const along = _toLabel.dot(ray.direction);
        if (along <= 0) return;
        const off = _toLabel.addScaledVector(ray.direction, -along).length();
        if (off > object.getWorldScale(_labelScale).x / 2) return; // within the card's real half width
        if (best == null || along < best.along) best = { measureId, along };
    });
    return best?.measureId ?? null;
}

/*
* XR: the end handle ({ id, which }) a ray aims at, or null: the ray passes within HANDLE_AIM radians of
* its center (seen from the ray's origin); the nearest along the ray wins.
*/
const _toHandle = new THREE.Vector3(), _handlePosition = new THREE.Vector3();
function handleUnderRay(ray, root) {
    let best = null;
    root.traverse((object) => {
        const handle = object.userData.measureHandle;
        if (handle == null) return;
        object.getWorldPosition(_handlePosition);
        _toHandle.subVectors(_handlePosition, ray.origin);
        const along = _toHandle.dot(ray.direction);
        if (along <= 0) return;
        const off = _toHandle.addScaledVector(ray.direction, -along).length();
        if (off > HANDLE_AIM * along) return;
        if (best == null || along < best.along) best = { handle, along };
    });
    return best?.handle ?? null;
}

// Second click / select: select a label, or place the first point, or finish the measure
function placeRulerPoint(hit) {
    if (hit == null) return;
    const { measures, selectMeasure, setMeasureStart, addMeasure } = useStore.getState();
    if (hit.measureId != null) return selectMeasure(hit.measureId);
    if (measures.start == null) setMeasureStart(hit.end);
    else addMeasure(hit.end);
}

function isInRoom(object) {
    for (let o = object; o != null; o = o.parent) if (o.userData.isRoom) return true;
    return false;
}

/*
* Desktop ruler mode: hover preview (snapped point + live measure from the first point) and still clicks
* placing the points. Listens on the window (not stopping anything) so the camera still orbits.
*/
function MeasurePlacer({ rootRef, boost }) {
    const gl = useThree((state) => state.gl);
    const camera = useThree((state) => state.camera);
    const active = useStore((state) => state.measures.active);
    const start = useStore((state) => state.measures.start);
    const [hover, setHover] = useState(null); // { point, kind } under the pointer

    useEffect(() => {
        if (!active) return undefined;
        const element = gl.domElement;
        // The point under the mouse (Shift = free direction)
        const cast = (event) => {
            const board = rootRef.current?.parent;
            if (board == null) return null;
            const rect = element.getBoundingClientRect();
            _ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
            _raycaster.setFromCamera(_ndc, camera);
            return rulerPoint(_raycaster, board, rootRef.current, camera, event.shiftKey);
        };
        let lastMove = null; // re-evaluated when Shift goes down / up without moving the mouse
        let pressAt = null;
        const move = (event) => {
            lastMove = event;
            if (event.target !== element) return setHover(null);
            const hit = cast(event);
            setHover(hit?.end ? hit : null);
        };
        // a press on an end handle is a drag (MeasureEndDragger), not a ruler point
        const down = (event) => {
            const onHandle = handleAt(event, element, camera, rootRef.current) != null;
            pressAt = event.target === element && !onHandle ? [event.clientX, event.clientY] : null;
        };
        const up = (event) => {
            if (pressAt == null || event.target !== element) return;
            const moved = Math.hypot(event.clientX - pressAt[0], event.clientY - pressAt[1]);
            pressAt = null;
            if (moved > CLICK_SLOP) return; // an orbit
            placeRulerPoint(cast(event));
        };
        const key = (event) => {
            if (event.key === 'Shift') {
                // same pointer position, new Shift state
                if (lastMove?.target === element) {
                    const hit = cast({ clientX: lastMove.clientX, clientY: lastMove.clientY, shiftKey: event.type === 'keydown' });
                    setHover(hit?.end ? hit : null);
                }
                return;
            }
            if (event.type !== 'keydown' || event.key !== 'Escape') return;
            const { measures, setMeasureStart, setMeasuring } = useStore.getState();
            if (measures.start != null) setMeasureStart(null);
            else setMeasuring(false);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerdown', down, true);
        window.addEventListener('pointerup', up, true);
        window.addEventListener('keydown', key);
        window.addEventListener('keyup', key);
        document.body.classList.add('measuring'); // crosshair cursor on the canvas (measures.css)
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerdown', down, true);
            window.removeEventListener('pointerup', up, true);
            window.removeEventListener('keydown', key);
            window.removeEventListener('keyup', key);
            document.body.classList.remove('measuring');
            setHover(null);
        };
    }, [active, gl, camera, rootRef]);

    if (!active) return null;
    return <RulerPreview start={start} hover={hover} boost={boost} />;
}

// The end handle ({ id, which }) under the mouse event, or null (sprites: the desktop raycaster has the camera)
function handleAt(event, element, camera, root) {
    if (root == null) return null;
    const rect = element.getBoundingClientRect();
    _ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    _raycaster.setFromCamera(_ndc, camera);
    const hit = _raycaster.intersectObject(root, true).find((item) => item.object.userData.measureHandle != null);
    return hit?.object.userData.measureHandle ?? null;
}

/*
* Desktop: drag the end handles of my selected temporary measure (ruler on or off). Window listeners in
* the capture phase: a press on a handle is stopped there, so the camera does not orbit and objects are
* not grabbed. The moved end: rulerPoint from the OTHER end (axis lock, Shift = free), this measure
* excluded from the snaps; live preview through onDraft, saved on release (one store write).
*/
function MeasureEndDragger({ rootRef, onDraft }) {
    const gl = useThree((state) => state.gl);
    const camera = useThree((state) => state.camera);

    useEffect(() => {
        const element = gl.domElement;
        let drag = null; // { id, which, other (end), draft }
        const down = (event) => {
            if (event.button !== 0 || event.target !== element) return;
            const handle = handleAt(event, element, camera, rootRef.current);
            const { local, items } = useStore.getState().measures;
            const measure = handle && [...local, ...items].find((item) => item.id === handle.id);
            if (measure == null) return;
            event.stopPropagation();
            drag = { ...handle, other: toEnd(handle.which === 'a' ? measure.b : measure.a), draft: null };
            setCursorGrabbing('measure-handle', true);
        };
        const move = (event) => {
            if (drag == null) {
                // hover: hand cursor over a handle (sceneCursor.js)
                setCursorHover('measure-handle', event.target === element && handleAt(event, element, camera, rootRef.current) != null);
                return;
            }
            const board = rootRef.current?.parent;
            if (board == null) return;
            const rect = element.getBoundingClientRect();
            _ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
            _raycaster.setFromCamera(_ndc, camera);
            const hit = rulerPoint(_raycaster, board, rootRef.current, camera, event.shiftKey, drag.other, drag.id);
            if (hit?.end == null) return; // over a label / nothing: keep the last position
            drag.draft = { id: drag.id, which: drag.which, end: hit.end, kind: hit.kind };
            onDraft(drag.draft);
        };
        const up = (event) => {
            if (drag == null) return;
            event.stopPropagation();
            if (drag.draft) useStore.getState().moveMeasureEnd(drag.id, drag.which, drag.draft.end);
            drag = null;
            onDraft(null);
            setCursorGrabbing('measure-handle', false);
        };
        window.addEventListener('pointerdown', down, true);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up, true);
        return () => {
            window.removeEventListener('pointerdown', down, true);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up, true);
            setCursorHover('measure-handle', false);
            setCursorGrabbing('measure-handle', false);
            onDraft(null);
        };
    }, [gl, camera, rootRef, onDraft]);
    return null;
}

// Snapped point under the pointer + the live measure from the first point (both placers)
function RulerPreview({ start, hover, boost }) {
    return (
        <>
            {hover && <Dot position={hover.end.p} color={SNAP_COLORS[hover.kind]} scale={1.4} />}
            {start && !hover && <FollowDot end={start} color={LOCAL_COLOR} />}
            {start && hover && (
                <MeasureLine measure={{ id: 'preview', a: start, b: hover.end }} color={hover.axis ? AXIS_COLORS[hover.axis] : LOCAL_COLOR} boost={boost} preview />
            )}
        </>
    );
}

/*
* XR ruler mode (wrist menu ruler button): the target ray of the hand / controller that last pressed
* (right one at first) previews every frame; a "select" (trigger, pinch) takes the point, or selects the
* label it aims at (its actions open in VRMeasurePanel.jsx). Read from the session's select event like
* the post-it placing (objects own their pointer events); selects while the wrist menu is shown are
* ignored (that ray is pressing a menu button). Free direction: wrist button (store measures.free).
* The hover state changes only when the shown point does (no re-render per frame otherwise).
*/
function XRMeasurePlacer({ rootRef, boost, onDraft }) {
    const session = useXR((state) => state.session);
    const gl = useThree((state) => state.gl);
    const camera = useThree((state) => state.camera);
    const getThree = useThree((state) => state.get);
    const active = useStore((state) => state.measures.active);
    const start = useStore((state) => state.measures.start);
    const [hover, setHover] = useState(null);
    const sourceRef = useRef(null); // input source aiming the ruler
    const hoverKey = useRef('');
    const dragRef = useRef(null); // { source, id, which, other, draft } while a handle is dragged

    // ray of `source` in `frame` into _raycaster; false when not tracked
    const aim = (frame, source) => {
        const pose = source && frame.getPose(source.targetRaySpace, gl.xr.getReferenceSpace());
        if (pose == null) return false;
        _rayMatrix.fromArray(pose.transform.matrix);
        _raycaster.ray.origin.setFromMatrixPosition(_rayMatrix);
        _raycaster.ray.direction.set(0, 0, -1).transformDirection(_rayMatrix); // target rays point along -Z
        _raycaster.camera = camera; // labels (sprites) need it to be hit-tested
        return true;
    };
    const cast = (frame, source) => {
        const board = rootRef.current?.parent;
        if (board == null || !aim(frame, source)) return null;
        return rulerPoint(_raycaster, board, rootRef.current, camera, useStore.getState().measures.free);
    };

    /*
    * Selects: always listened to in XR, so a measure label can be selected (its actions panel opens)
    * with the ruler off too; with the ruler on, a select elsewhere places a point.
    */
    useEffect(() => {
        if (session == null) return undefined;
        // press on a handle of my selected temporary measure: drag that end until the release
        const selectStart = (event) => {
            if (useStore.getState().view.handMenuVisible || rootRef.current == null) return;
            if (!aim(event.frame, event.inputSource)) return;
            const handle = handleUnderRay(_raycaster.ray, rootRef.current);
            const { local, items } = useStore.getState().measures;
            const measure = handle && [...local, ...items].find((item) => item.id === handle.id);
            if (measure == null) return;
            dragRef.current = { source: event.inputSource, ...handle, other: toEnd(handle.which === 'a' ? measure.b : measure.a), draft: null };
        };
        const selectEnd = (event) => {
            const drag = dragRef.current;
            if (drag == null || drag.source !== event.inputSource) return;
            if (drag.draft) useStore.getState().moveMeasureEnd(drag.id, drag.which, drag.draft.end);
            dragRef.current = null;
            onDraft(null);
        };
        const select = (event) => {
            if (dragRef.current != null) return; // the release of a handle drag (select fires before selectend)
            if (useStore.getState().view.handMenuVisible || rootRef.current == null) return;
            if (!aim(event.frame, event.inputSource)) return;
            // a select aimed at a VR panel (its buttons, grab bar) is for the panel, not the ruler
            if (_raycaster.intersectObjects(getThree().scene.children, true).some((item) => item.object.userData.vrPanel)) return;
            const labelId = labelUnderRay(_raycaster.ray, rootRef.current, camera);
            if (labelId != null) return useStore.getState().selectMeasure(labelId);
            if (!useStore.getState().measures.active) return;
            sourceRef.current = event.inputSource;
            placeRulerPoint(cast(event.frame, event.inputSource));
        };
        session.addEventListener('selectstart', selectStart);
        session.addEventListener('select', select);
        session.addEventListener('selectend', selectEnd);
        return () => {
            session.removeEventListener('selectstart', selectStart);
            session.removeEventListener('select', select);
            session.removeEventListener('selectend', selectEnd);
            dragRef.current = null;
            onDraft(null);
        };
    }, [session]); // eslint-disable-line react-hooks/exhaustive-deps -- aim/cast read refs and the store

    useFrame((_state, _delta, frame) => {
        // handle drag: the end follows the ray (axis lock from the other end, wrist "Free" = free)
        const drag = dragRef.current;
        const board = rootRef.current?.parent;
        if (drag != null && frame != null && board != null && aim(frame, drag.source)) {
            const hit = rulerPoint(_raycaster, board, rootRef.current, camera, useStore.getState().measures.free, drag.other, drag.id);
            const key = hit?.end ? hit.end.p.map((v) => v.toFixed(3)).join(',') : null;
            if (key != null && key !== drag.key) {
                drag.key = key;
                drag.draft = { id: drag.id, which: drag.which, end: hit.end, kind: hit.kind };
                onDraft(drag.draft);
            }
        }
        if (!active || frame == null || session == null) return;
        if (sourceRef.current == null || ![...session.inputSources].includes(sourceRef.current)) {
            sourceRef.current = [...session.inputSources].find((source) => source.handedness === 'right') ?? null;
        }
        const hit = useStore.getState().view.handMenuVisible ? null : cast(frame, sourceRef.current);
        const next = hit?.end ? hit : null;
        const key = next ? `${next.kind}|${next.axis}|${next.end.p.map((v) => v.toFixed(3)).join(',')}` : '';
        if (key !== hoverKey.current) {
            hoverKey.current = key;
            setHover(next);
        }
    });

    if (!active) return null;
    return <RulerPreview start={start} hover={hover} boost={boost} />;
}

// Round marker texture (white disc with a dark rim, tinted by the material color), shared by every dot
let dotTexture = null;
function getDotTexture() {
    if (dotTexture == null) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.beginPath();
        ctx.arc(32, 32, 26, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(10, 16, 32, 0.85)';
        ctx.stroke();
        dotTexture = new THREE.CanvasTexture(canvas);
        dotTexture.colorSpace = THREE.SRGBColorSpace;
    }
    return dotTexture;
}

// End point / snap marker: a circle of constant size on screen, drawn over everything
function Dot({ position, color, scale = 1, dotRef, handle }) {
    return (
        <sprite ref={dotRef} position={position} scale={[DOT_SIZE * scale, DOT_SIZE * scale, 1]} renderOrder={10}
            raycast={handle ? labelRaycast : noRaycast} userData={handle ? { measureHandle: handle } : undefined}>
            <spriteMaterial map={getDotTexture()} color={color} transparent sizeAttenuation={false} depthTest={false} depthWrite={false} toneMapped={false} />
        </sprite>
    );
}

// A dot on an end that may be anchored on a (moving) object: placed every frame
function FollowDot({ end, color }) {
    const dotRef = useRef();
    useFrame(() => {
        const space = dotRef.current?.parent;
        if (space != null) resolveEnd(end, space, dotRef.current.position);
    });
    return <Dot dotRef={dotRef} position={end.p} color={color} />;
}

/*
* One measure: line (thin cylinder between the points), end dots, length label at the middle.
* Placed every frame from its resolved ends (resolveEnd: live for ends anchored on objects); the label
* text (a canvas texture) is re-rendered only when the shown value changes.
* `saved`: shared measure (no Save action). `preview`: the live one while measuring (not clickable).
*/
function MeasureLine({ measure, color, boost, selected = false, saved = false, preview = false, editable = false }) {
    const isXR = useXR((state) => state.mode != null); // XR: actions in VRMeasurePanel.jsx instead of Html
    // not clickable: the live preview, and every label on the tabletop (labels are selectable in the builder too)
    const isTabletop = useStore((state) => state.view.mode === 'tabletop') && isXR;
    const isLocked = preview || isTabletop;
    const labelBoost = isTabletop ? TABLETOP_LABEL_BOOST : 1;
    // HOVER (mouse or XR ray: pmndrs pointer events, the ray stops on the card): grows like a note marker,
    // hand cursor on desktop (sceneCursor.js)
    const [isHovered, setIsHovered] = useState(false);
    const hovered = isHovered && !isLocked;
    const hoverScaleRef = useRef(1);
    useEffect(() => {
        setCursorHover(`measure:${measure.id}`, hovered && !isXR);
        return () => setCursorHover(`measure:${measure.id}`, false);
    }, [measure.id, hovered, isXR]);
    // 2D plan open: its own actions (builder/PlanMeasures.jsx); this Html would float over the plan
    const isPlanView = useStore((state) => state.workspace === 'builder' && state.builderView === '2d');
    const a = toEnd(measure.a), b = toEnd(measure.b);
    const groupRef = useRef(), lineRef = useRef(), dotARef = useRef(), dotBRef = useRef(), labelRef = useRef(), labelMeshRef = useRef();
    const [text, setText] = useState(() => formatLength(new THREE.Vector3(...a.p).distanceTo(new THREE.Vector3(...b.p))));
    const textRef = useRef(text);
    const radius = LINE_RADIUS * boost;

    useFrame(({ camera }, delta) => {
        const space = groupRef.current?.parent;
        if (space == null) return;
        const start = resolveEnd(a, space, _start), end = resolveEnd(b, space, _end);
        const length = start.distanceTo(end);
        _direction.subVectors(end, start);
        _middle.addVectors(start, end).multiplyScalar(0.5);
        lineRef.current.position.copy(_middle);
        lineRef.current.quaternion.setFromUnitVectors(_up, length > 0 ? _direction.divideScalar(length) : _up);
        lineRef.current.scale.set(radius, length, radius);
        dotARef.current.position.copy(start);
        dotBRef.current.position.copy(end);
        labelRef.current.position.copy(_middle);
        // LABEL: a flat card in 3D, its long side ALONG the line, turned around the line to face the eye as
        // much as it can, text never upside down (its up has a positive world-up component; the board only
        // turns around Y, so local up = world up). Stereo-safe: a real 3D orientation, not a screen-space one.
        const card = labelMeshRef.current;
        if (card != null && length > 1e-6) {
            camera.getWorldPosition(_eyeLocal);
            space.worldToLocal(_eyeLocal);
            _axisX.copy(_direction); // unit, start -> end (normalized above)
            _axisZ.subVectors(_eyeLocal, _middle);
            _axisZ.addScaledVector(_axisX, -_axisZ.dot(_axisX)); // towards the eye, square to the line
            if (_axisZ.lengthSq() < 1e-10) _axisZ.set(0, 1, 0).cross(_axisX); // looking straight along the line
            _axisZ.normalize();
            _axisY.crossVectors(_axisZ, _axisX);
            if (_axisY.y < 0) { _axisX.negate(); _axisY.negate(); } // text upright (turned 180° around Z)
            card.quaternion.setFromRotationMatrix(_basis.makeBasis(_axisX, _axisY, _axisZ));
            hoverScaleRef.current = THREE.MathUtils.damp(hoverScaleRef.current, hovered ? LABEL_HOVER_SCALE : 1, 12, delta);
            const size = labelBoost * hoverScaleRef.current;
            card.scale.set(LABEL_SIZE[0] * size, LABEL_SIZE[1] * size, 1);
        }
        const shown = formatLength(length);
        if (shown !== textRef.current) {
            textRef.current = shown;
            setText(shown);
        }
    });

    const label = useCanvasTexture(320, 96, (ctx, w, h) => drawLabel(ctx, w, h, text, color, selected), [text, color, selected]);
    const { selectMeasure, saveMeasure, removeMeasure } = useStore.getState();

    return (
        <group ref={groupRef}>
            <mesh ref={lineRef} geometry={cylinder} dispose={null} raycast={noRaycast} renderOrder={9}>
                <meshBasicMaterial color={color} depthTest={false} depthWrite={false} transparent opacity={0.9} toneMapped={false} />
            </mesh>
            {/* editable (my selected temporary measure): bigger dots, grabbable (MeasureEndDragger) */}
            <Dot dotRef={dotARef} position={a.p} color={color} scale={editable ? HANDLE_SCALE : 1} handle={editable ? { id: measure.id, which: 'a' } : undefined} />
            <Dot dotRef={dotBRef} position={b.p} color={color} scale={editable ? HANDLE_SCALE : 1} handle={editable ? { id: measure.id, which: 'b' } : undefined} />
            <group ref={labelRef} position={a.p}>
                {/* oriented and sized every frame (useFrame above); a plain mesh: hit-tested by any ray */}
                <mesh
                    ref={labelMeshRef}
                    geometry={labelPlane}
                    dispose={null}
                    renderOrder={11}
                    // drawn over everything, so it also WINS the pointer events (like the notes' cards and the gizmo):
                    // a measure taken on a wall has its label flush with the wall, which would be hit first
                    pointerEventsOrder={1}
                    userData={isLocked ? undefined : { measureId: measure.id }}
                    raycast={isLocked ? noRaycast : undefined}
                    // XR: selection comes from the session's select (XRMeasurePlacer), not this click (no double toggle)
                    onClick={isLocked || isXR ? undefined : (event) => { event.stopPropagation(); selectMeasure(selected ? null : measure.id); }}
                    onPointerEnter={isLocked ? undefined : () => setIsHovered(true)}
                    onPointerLeave={isLocked ? undefined : () => setIsHovered(false)}
                >
                    <meshBasicMaterial map={label} side={THREE.DoubleSide} depthTest={false} depthWrite={false} transparent toneMapped={false} />
                </mesh>
                {selected && !isXR && !isPlanView && (
                    <Html center zIndexRange={[50, 0]} style={{ pointerEvents: 'none' }}>
                        <div className="measure-actions">
                            {!saved && <button className="primary" onClick={() => saveMeasure(measure.id)} title="Save and share with the room">Save</button>}
                            <button onClick={() => removeMeasure(measure.id)} title="Delete this measure">Delete</button>
                            <button onClick={() => selectMeasure(null)} aria-label="Close">×</button>
                        </div>
                    </Html>
                )}
            </group>
        </group>
    );
}
const _eyeLocal = new THREE.Vector3(), _axisX = new THREE.Vector3(), _axisY = new THREE.Vector3(), _axisZ = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _start = new THREE.Vector3(), _end = new THREE.Vector3(), _direction = new THREE.Vector3(), _middle = new THREE.Vector3();

// Length label: dark glass pill with an outline in the measure's color (brighter when selected)
function drawLabel(ctx, w, h, text, color, selected) {
    const inset = 6;
    ctx.beginPath();
    ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, (h - inset * 2) / 2);
    ctx.fillStyle = selected ? 'rgba(40, 30, 10, 0.92)' : 'rgba(10, 16, 32, 0.85)';
    ctx.fill();
    ctx.lineWidth = selected ? 6 : 4;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(h * 0.45)}px "SUSE Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
}
