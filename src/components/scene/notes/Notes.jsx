import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import { useStore } from '../../../store/appStore';
import NameLabel from '../presence/NameLabel';

/*
* Post-it notes in the scene (data and rules: store/slices/notesSlice.js).
* - BoardNotes (inside the Board): notes stuck on room surfaces, plus the desktop placing mode.
* - NotePin: one note, a square of paper in its author's color just off the surface; hover shows the
*   author's name (same label as the multiplayer pointers), click opens the editor (ui/note-modal/).
*   Notes stuck on an object are rendered by SingleObject.jsx inside the object, so they follow it.
* Calibration knobs in board meters (real size at 1:1, scaled down with the tabletop model).
*/
const PAPER_SIZE = 0.12;           // side of the paper square
const PAPER_OFFSET = 0.004;        // distance from the surface (no z-fighting with walls and floor)
const LABEL_HEIGHT = 0.14;         // author label center above the note
const LABEL_SIZE = [0.36, 0.09];   // author label sprite [width, height]
const NOTE_USER_DATA = { isNote: true }; // skipped by placing and by surfaceDrag.js (never a support)

const _forward = new THREE.Vector3(0, 0, 1); // planeGeometry faces +Z
const _ndc = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();
const _normal = new THREE.Vector3();
const _boardQuaternion = new THREE.Quaternion();

export default function BoardNotes() {
    const anchorRef = useRef(); // child of the board: its parent is the board root
    const items = useStore((state) => state.notes.items);
    const isXR = useXR((state) => state.mode != null);

    return (
        <group ref={anchorRef}>
            {!isXR && <NotePlacer anchorRef={anchorRef} />}
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
    const isXR = useXR((state) => state.mode != null);
    const openNote = useStore((state) => state.openNote);

    const { scale, quaternion } = useMemo(() => {
        const s = objectScale ?? [1, 1, 1];
        // geometry normal -> normal of the scaled surface (normals scale by the inverse)
        const normal = new THREE.Vector3(note.n[0] / s[0], note.n[1] / s[1], note.n[2] / s[2]).normalize();
        return {
            scale: [1 / s[0], 1 / s[1], 1 / s[2]],
            quaternion: new THREE.Quaternion().setFromUnitVectors(_forward, normal)
        };
    }, [note.n, objectScale]);

    // ponytail: the editor is a DOM modal, so in XR a click does nothing yet (VR window: next step)
    const handleClick = (event) => {
        event.stopPropagation();
        if (!isXR) openNote(note.id);
    };

    return (
        <group position={note.p} scale={scale}>
            {/* turned onto the surface; the paper stands off it along its local +Z (= the normal) */}
            <group quaternion={quaternion}>
                <mesh
                    position={[0, 0, PAPER_OFFSET]}
                    userData={NOTE_USER_DATA}
                    receiveShadow
                    onClick={handleClick}
                    onPointerEnter={() => setIsHovered(true)}
                    onPointerLeave={() => setIsHovered(false)}
                >
                    <planeGeometry args={[PAPER_SIZE, PAPER_SIZE]} />
                    <meshStandardMaterial color={note.author.color} side={THREE.DoubleSide} />
                </mesh>
            </group>
            {isHovered && <NameLabel name={note.author.name} color={note.author.color} size={LABEL_SIZE} position={[0, LABEL_HEIGHT, 0]} />}
        </group>
    );
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
