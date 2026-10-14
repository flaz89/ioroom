import { useState } from 'react';
import CircleButton from '../circle-button/CircleButton';
import { svg } from '../../../utils/svg-logos';
import { getRoomId } from '../../../sync/roomSync';
import { createRoom, deleteRoom, duplicateRoom, listRooms, renameRoom } from '../../../sync/roomsApi';
import './rooms-panel.css';

// Opens an environment: full reload on ?room=<id> (the sync connects once per page load, and the
// previous room's scene must not be merged into the next one)
function openRoom(id) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('room', id);
    else url.searchParams.delete('room');
    window.location.assign(url);
}

const formatDate = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

/*
* "My environments" toolbar button (owner only for now): a centered modal listing the saved environments
* (shared rooms), most recently edited first. Click a name to open it; per row: rename (inline field),
* duplicate, delete (second click confirms). "New" creates an empty environment and opens it.
* Closed by default; a click on the dimmed backdrop closes it.
* Server side: server/src/index.js; requests: sync/roomsApi.js.
*/
export default function RoomsPanel() {
    const currentRoom = getRoomId();
    const [isOpen, setIsOpen] = useState(false);
    const [rooms, setRooms] = useState(null);       // null while loading
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);        // a request is running: actions disabled
    const [editing, setEditing] = useState(null);   // { id, name } of the row being renamed
    const [confirmDelete, setConfirmDelete] = useState(null); // id waiting for the confirming click

    // Runs an API action, then reloads the list; errors are shown in the panel. Resolves true on success.
    const run = async (action) => {
        setBusy(true);
        setError(null);
        try {
            await action();
            setRooms(await listRooms());
            return true;
        } catch (err) {
            setError(err.message);
            return false;
        } finally {
            setBusy(false);
        }
    };

    // Fresh list every time the panel opens (another device may have changed it)
    const toggle = () => {
        if (isOpen) return setIsOpen(false);
        setEditing(null);
        setConfirmDelete(null);
        setIsOpen(true);
        run(async () => {});
    };

    const create = async () => {
        setBusy(true);
        try {
            openRoom((await createRoom()).id);
        } catch (err) {
            setError(err.message);
            setBusy(false);
        }
    };

    const saveName = () => {
        const { id, name } = editing;
        setEditing(null);
        if (name.trim()) run(() => renameRoom(id, name));
    };

    const remove = (id) => {
        if (confirmDelete !== id) return setConfirmDelete(id);
        setConfirmDelete(null);
        // Deleting the open environment leaves the page without a room: back to the list
        if (id === currentRoom) run(() => deleteRoom(id)).then((ok) => ok && openRoom(null));
        else run(() => deleteRoom(id));
    };

    return (
        <div className="rooms-control">
            <CircleButton svg={svg.environments} onClick={toggle} isActive={isOpen} title="My environments" />
            {isOpen && (
                <div className="rooms-backdrop" onClick={() => setIsOpen(false)}>
                <div className="rooms-panel" onClick={(event) => event.stopPropagation()}>
                    <div className="rooms-header">
                        <span className="rooms-title">My environments</span>
                        <button className="rooms-new" onClick={create} disabled={busy}>+ New</button>
                    </div>

                    {error && <span className="rooms-error" role="alert">{error}</span>}
                    {rooms == null && !error && <span className="rooms-empty">Loading…</span>}
                    {rooms?.length === 0 && <span className="rooms-empty">No environments yet: create the first one.</span>}

                    <ul className="rooms-list">
                        {rooms?.map((room) => (
                            <li key={room.id} className={room.id === currentRoom ? 'rooms-item current' : 'rooms-item'}>
                                {editing?.id === room.id ? (
                                    <input
                                        className="rooms-name-input"
                                        value={editing.name}
                                        maxLength={80}
                                        autoFocus
                                        onChange={(event) => setEditing({ id: room.id, name: event.target.value })}
                                        onBlur={saveName}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') event.target.blur();
                                            if (event.key === 'Escape') setEditing(null);
                                        }}
                                    />
                                ) : (
                                    <button className="rooms-open" onClick={() => openRoom(room.id)} disabled={busy}
                                        title={room.id === currentRoom ? 'Open now' : 'Open'}>
                                        <span className="rooms-name">{room.name}</span>
                                        <span className="rooms-date">{formatDate(room.updatedAt)}</span>
                                    </button>
                                )}
                                <div className="rooms-actions">
                                    <button onClick={() => setEditing({ id: room.id, name: room.name })} disabled={busy}>Rename</button>
                                    <button onClick={() => run(() => duplicateRoom(room.id))} disabled={busy}>Duplicate</button>
                                    <button className="danger" onClick={() => remove(room.id)} disabled={busy}>
                                        {confirmDelete === room.id ? 'Confirm?' : 'Delete'}
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
                </div>
            )}
        </div>
    );
}
