import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import { useStore } from '../../../store/appStore';
import { getSelfUser } from '../../../sync/presence';
import { drawPanel, useCanvasTexture, wrapLines } from './useCanvasTexture';
import VRButton from './VRButton';
import { PointerFilterContext, acceptsPanelPointer } from './pointers';
import { placeInFrontOfUser } from './layout';

/*
* In-VR post-it editor (store/slices/notesSlice.js; desktop counterpart: ui/note-modal/NoteModal.jsx).
* Shown in XR while a note is open (click on a note marker) or being written (draft).
* Placed once in front of the user, like the sun panel (VRSunPanel.jsx).
*
* Typing: the Quest system keyboard (Meta "System Keyboard in WebXR", Quest Browser 26.1+). A press on
* the text box focuses a hidden DOM text field: the keyboard appears and its `value` arrives through
* `input` events. That keyboard starts a new editing session every time it opens (its first key press
* replaces the field's whole value), so the field only holds what is typed in this session and it is
* APPENDED to the text the note had when the keyboard opened. Backspace erases the new text only;
* "Clear" empties the note to rewrite it.
* Without keyboard support (session.isSystemKeyboardSupported false) notes can be read and deleted only.
* Rows: header (author, X) · text box · buttons (Delete [existing notes] · Clear · Save).
* Calibration knobs in meters: tune on the headset.
*/
const DISTANCE = 0.45;          // in front of the eyes (horizontal)
const BELOW_EYES = 0.15;
const WIDTH = 0.34;
const HEADER_H = 0.04;
const TEXT_H = 0.15;
const BUTTONS_H = 0.05;
const PAD = 0.015;
const HEIGHT = HEADER_H + TEXT_H + BUTTONS_H + PAD;
const BUTTON = [0.09, 0.032];
const PIXELS_PER_METER = 3000;
const MAX_LENGTH = 500;         // same limit as the desktop editor
const MAX_LINES = 7;
const TEXT_BOX = { x: PAD, top: HEADER_H, height: TEXT_H - 0.01 }; // meters, from the panel's top left

export default function VRNotePanel() {
    const draft = useStore((state) => state.notes.draft);
    const note = useStore((state) => state.notes.items.find((item) => item.id === state.notes.openId));
    if (draft == null && note == null) return null;
    // keyed: a fresh panel (text, placement in front of the user) for every note opened
    return <NoteEditorPanel key={note?.id ?? 'draft'} note={note} />;
}

function NoteEditorPanel({ note }) {
    const groupRef = useRef();
    const getThree = useThree((state) => state.get);
    const session = useXR((state) => state.session);
    const [text, setText] = useState(note?.text ?? '');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const { saveNote, closeNote, removeNote } = useStore.getState(); // actions never change
    const author = note?.author ?? getSelfUser();
    const canType = session?.isSystemKeyboardSupported === true;
    const canSave = text.trim() !== '' && text !== note?.text;

    useLayoutEffect(() => {
        placeInFrontOfUser(groupRef.current, getThree().camera, DISTANCE, BELOW_EYES);
    }, [getThree]);

    // Hidden DOM field for the system keyboard: in the DOM (required), fixed at the top left corner so
    // typing never scrolls the page; removed when the panel closes (also when the session ends)
    const fieldRef = useRef(null);
    const baseRef = useRef(''); // the note's text when the keyboard opened; typed text is appended to it
    useEffect(() => {
        const field = document.createElement('input');
        field.type = 'text';
        field.setAttribute('aria-hidden', 'true');
        Object.assign(field.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
        field.addEventListener('input', () => setText((baseRef.current + field.value).slice(0, MAX_LENGTH)));
        field.addEventListener('focus', () => setIsTyping(true));
        field.addEventListener('blur', () => setIsTyping(false)); // keyboard dismissed (Done, hide, click outside)
        document.body.appendChild(field);
        fieldRef.current = field;
        return () => field.remove();
    }, []);

    // press on the text box: open the keyboard, appending to the current text (a space in between)
    const type = () => {
        if (!canType) return;
        baseRef.current = text === '' || /\s$/.test(text) ? text : `${text} `;
        const field = fieldRef.current;
        field.value = '';
        field.focus();
    };
    const clear = () => {
        setText('');
        baseRef.current = '';
        fieldRef.current.value = '';
    };
    const save = () => { if (canSave) saveNote(text.trim()); };
    const remove = () => {
        if (!confirmDelete) return setConfirmDelete(true);
        removeNote(note.id);
    };

    // Background: glass panel, author (color dot + name), dark text box with the wrapped text
    const background = useCanvasTexture(Math.round(WIDTH * PIXELS_PER_METER), Math.round(HEIGHT * PIXELS_PER_METER), (ctx, w, h) => {
        const px = (meters) => meters * PIXELS_PER_METER;
        drawPanel(ctx, w, h, 'rgba(16, 20, 48, 0.9)', author.color);
        // header
        ctx.beginPath();
        ctx.arc(px(PAD + 0.008), px(HEADER_H / 2 + 0.004), px(0.007), 0, Math.PI * 2);
        ctx.fillStyle = author.color;
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 ${px(0.016)}px "SUSE Mono", monospace`;
        ctx.textBaseline = 'middle';
        ctx.fillText(`${author.name.toUpperCase()}${note == null ? ' · NEW NOTE' : ''}`, px(PAD + 0.022), px(HEADER_H / 2 + 0.005));
        // text box
        const box = { x: px(TEXT_BOX.x), y: px(TEXT_BOX.top), w: w - px(TEXT_BOX.x) * 2, h: px(TEXT_BOX.height) };
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.strokeStyle = isTyping ? author.color : 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 3;
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        const lineHeight = box.h / MAX_LINES;
        ctx.font = `400 ${lineHeight * 0.62}px "SUSE Mono", monospace`;
        ctx.textBaseline = 'middle';
        const empty = text === '';
        ctx.fillStyle = empty ? 'rgba(255, 255, 255, 0.45)' : '#ffffff';
        const placeholder = canType ? 'Tap here to write…' : 'Keyboard not available on this device';
        wrapLines(ctx, empty ? placeholder : text, box.w - px(0.016), MAX_LINES).forEach((line, index) => {
            ctx.fillText(line, box.x + px(0.008), box.y + lineHeight * (index + 0.5));
        });
    }, [text, isTyping, author.name, author.color, note == null, canType]);

    const top = HEIGHT / 2;
    const buttonsY = -top + PAD / 2 + BUTTONS_H / 2;

    return (
        <PointerFilterContext.Provider value={acceptsPanelPointer}>
        <group ref={groupRef}>
            {/* catches presses so they never reach the scene behind the panel; drawn before the buttons */}
            <mesh position-z={-0.001} renderOrder={-1} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                <planeGeometry args={[WIDTH, HEIGHT]} />
                <meshBasicMaterial map={background} transparent toneMapped={false} />
            </mesh>
            <VRButton label="X" size={[0.026, 0.026]} onClick={closeNote} position={[WIDTH / 2 - PAD - 0.006, top - HEADER_H / 2 - 0.002, 0.001]} />
            {/* text box hit area (drawn by the background texture): a press opens the keyboard */}
            <mesh
                position={[0, top - TEXT_BOX.top - TEXT_BOX.height / 2, 0.0005]}
                pointerEventsType={acceptsPanelPointer}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); type(); }}
            >
                <planeGeometry args={[WIDTH - TEXT_BOX.x * 2, TEXT_BOX.height]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>

            <group position={[0, buttonsY, 0.001]}>
                {note != null && (
                    <VRButton label={confirmDelete ? 'Confirm?' : 'Delete'} size={BUTTON} onClick={remove} position={[-WIDTH / 2 + PAD + BUTTON[0] / 2, 0, 0]} />
                )}
                {canType && text !== '' && <VRButton label="Clear" size={BUTTON} onClick={clear} position={[WIDTH / 2 - PAD - BUTTON[0] * 1.5 - 0.008, 0, 0]} />}
                {canSave && <VRButton label="Save" size={BUTTON} active onClick={save} position={[WIDTH / 2 - PAD - BUTTON[0] / 2, 0, 0]} />}
            </group>
        </group>
        </PointerFilterContext.Provider>
    );
}
