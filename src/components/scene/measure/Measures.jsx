import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useXR } from '@react-three/xr';
import { useStore } from '../../../store/appStore';
import { useCanvasTexture } from '../xr-ui/useCanvasTexture';
import { formatLength, lockToAxis, snapPoint, snapToSegments } from './measureSnap';
import { objectMeshes } from '../level/objectMeshes';
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
const LABEL_SIZE = [0.1, 0.032];
const SNAP_SCREEN = 0.02;            // snap distance = 2% of the camera distance (same feel at any zoom)
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
    const isXR = useXR((state) => state.mode != null);
    const boost = useStore((state) => state.view.mode === 'tabletop') ? TABLETOP_BOOST : 1;

    return (
        <group ref={rootRef}>
            {isXR ? <XRMeasurePlacer rootRef={rootRef} boost={boost} /> : <MeasurePlacer rootRef={rootRef} boost={boost} />}
            {items.map((measure) => (
                <MeasureLine key={measure.id} measure={measure} color={measure.author?.color ?? LOCAL_COLOR} boost={boost}
                    selected={selectedId === measure.id} saved />
            ))}
            {local.map((measure) => (
                <MeasureLine key={measure.id} measure={measure} color={LOCAL_COLOR} boost={boost} selected={selectedId === measure.id} />
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
function rulerPoint(raycaster, board, root, camera, free) {
    const hit = rulerHit(raycaster, board, camera);
    if (hit?.measureId != null) return hit;
    // the ray in board space (measures and the room's axes live there, also on a rotated tabletop)
    _boardInverse.copy(board.matrixWorld).invert();
    _boardRay.origin.copy(raycaster.ray.origin).applyMatrix4(_boardInverse);
    _boardRay.direction.copy(raycaster.ray.direction).transformDirection(_boardInverse);
    // existing measures first: their ends / lines (often in the air, so tested on the ray)
    const onMeasure = measureSnap(_boardRay, root);
    const start = useStore.getState().measures.start;
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
function measureSnap(ray, root) {
    const { items, local } = useStore.getState().measures;
    const measures = [...items, ...local];
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
* XR: the measure label a ray aims at, or null. Not three's sprite raycast (unreliable for screen-sized
* sprites with the XR camera): a label counts as aimed at when the ray passes within half its on-screen
* width (a constant screen fraction, so LABEL_SIZE[0] / 2 x its distance from the eyes) of its center;
* the nearest one along the ray wins. Labels are drawn over everything, so they win over surfaces.
*/
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
        if (off > (LABEL_SIZE[0] / 2) * _labelPosition.distanceTo(_eye)) return;
        if (best == null || along < best.along) best = { measureId, along };
    });
    return best?.measureId ?? null;
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
        const down = (event) => { pressAt = event.target === element ? [event.clientX, event.clientY] : null; };
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
function XRMeasurePlacer({ rootRef, boost }) {
    const session = useXR((state) => state.session);
    const gl = useThree((state) => state.gl);
    const camera = useThree((state) => state.camera);
    const getThree = useThree((state) => state.get);
    const active = useStore((state) => state.measures.active);
    const start = useStore((state) => state.measures.start);
    const [hover, setHover] = useState(null);
    const sourceRef = useRef(null); // input source aiming the ruler
    const hoverKey = useRef('');

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
        const select = (event) => {
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
        session.addEventListener('select', select);
        return () => session.removeEventListener('select', select);
    }, [session]); // eslint-disable-line react-hooks/exhaustive-deps -- aim/cast read refs and the store

    useFrame((_state, _delta, frame) => {
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
function Dot({ position, color, scale = 1, dotRef }) {
    return (
        <sprite ref={dotRef} position={position} scale={[DOT_SIZE * scale, DOT_SIZE * scale, 1]} raycast={noRaycast} renderOrder={10}>
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
function MeasureLine({ measure, color, boost, selected = false, saved = false, preview = false }) {
    const isXR = useXR((state) => state.mode != null); // XR: actions in VRMeasurePanel.jsx instead of Html
    // builder: labels are not clickable (the mouse is for the walls; the ruler tool still measures)
    const isBuilder = useStore((state) => state.workspace === 'builder') && !isXR;
    const isLocked = preview || isBuilder;
    const a = toEnd(measure.a), b = toEnd(measure.b);
    const groupRef = useRef(), lineRef = useRef(), dotARef = useRef(), dotBRef = useRef(), labelRef = useRef();
    const [text, setText] = useState(() => formatLength(new THREE.Vector3(...a.p).distanceTo(new THREE.Vector3(...b.p))));
    const textRef = useRef(text);
    const radius = LINE_RADIUS * boost;

    useFrame(() => {
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
            <Dot dotRef={dotARef} position={a.p} color={color} />
            <Dot dotRef={dotBRef} position={b.p} color={color} />
            <group ref={labelRef} position={a.p}>
                <sprite
                    scale={[LABEL_SIZE[0], LABEL_SIZE[1], 1]}
                    renderOrder={11}
                    userData={isLocked ? undefined : { measureId: measure.id }}
                    raycast={isLocked ? noRaycast : labelRaycast}
                    onClick={isLocked ? undefined : (event) => { event.stopPropagation(); selectMeasure(selected ? null : measure.id); }}
                >
                    <spriteMaterial map={label} sizeAttenuation={false} depthTest={false} depthWrite={false} transparent toneMapped={false} />
                </sprite>
                {selected && !isXR && (
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
