import { useState } from 'react';
import { useStore } from '../../../store/appStore';
import { getSelfUser } from '../../../sync/presence';
import './note-modal.css';

const MAX_LENGTH = 500;

/*
* Post-it editor (store/slices/notesSlice.js): centered modal over a dimmed backdrop, shown for a new
* note (draft, after a click in placing mode) or for an existing one (click on its paper).
* Save: button or Ctrl/Cmd+Enter. Cancel: button, Esc or a click on the backdrop (a draft is dropped).
* Delete (existing notes): second click confirms.
*/
export default function NoteModal() {
    const draft = useStore((state) => state.notes.draft);
    const note = useStore((state) => state.notes.items.find((item) => item.id === state.notes.openId));
    if (draft == null && note == null) return null;
    // keyed: a fresh editor (text, confirm state) for every note opened
    return <NoteEditor key={note?.id ?? 'draft'} note={note} />;
}

function NoteEditor({ note }) {
    const [text, setText] = useState(note?.text ?? '');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const { saveNote, closeNote, removeNote } = useStore.getState(); // actions never change
    const author = note?.author ?? getSelfUser();
    const canSave = text.trim() !== '' && text !== note?.text;

    const save = () => { if (canSave) saveNote(text.trim()); };
    const remove = () => {
        if (!confirmDelete) return setConfirmDelete(true);
        removeNote(note.id);
    };

    return (
        <div className="note-backdrop" onClick={closeNote}>
            <div className="note-modal" role="dialog" aria-label="Note" onClick={(event) => event.stopPropagation()}>
                <div className="note-header">
                    <span className="note-author">
                        <span className="note-dot" style={{ background: author.color }} />
                        {author.name}
                    </span>
                    <span className="note-title">{note == null ? 'New note' : 'Note'}</span>
                </div>

                <textarea
                    className="note-text"
                    value={text}
                    maxLength={MAX_LENGTH}
                    rows={6}
                    autoFocus
                    placeholder="Write a note…"
                    onChange={(event) => setText(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') closeNote();
                        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) save();
                    }}
                />

                <div className="note-actions">
                    {note != null && (
                        <button className="danger" onClick={remove}>{confirmDelete ? 'Confirm?' : 'Delete'}</button>
                    )}
                    <button onClick={closeNote}>Cancel</button>
                    <button className="primary" onClick={save} disabled={!canSave}>Save</button>
                </div>
            </div>
        </div>
    );
}
