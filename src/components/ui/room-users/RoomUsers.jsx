import { useRoomUsers } from '../../../sync/presence';
import { useStore } from '../../../store/appStore';
import './room-users.css';

const MAX_DOTS = 4; // overlapping color dots shown in the collapsed group; the count covers the rest

/*
* People in the shared room (top left), collapsed into one pill: overlapping presence-color dots and the
* number of people. Tap/click it to open the list: one row per device with its presence color (the same
* color outlines the objects it is holding); this device comes first, marked "you". The list is one of
* the toolbar panels (store openPanel 'users'): opening another panel closes it. Hidden without a room.
* Names are device types for now (sync/presence.js deviceName); accounts will replace them.
*/
export default function RoomUsers() {
    const users = useRoomUsers();
    const isOpen = useStore((state) => state.openPanel === 'users');
    const togglePanel = useStore((state) => state.togglePanel);
    if (users.length === 0) return null;

    return (
        <div className="room-users">
            <button
                className={isOpen ? 'room-users-group is-active' : 'room-users-group'}
                onClick={() => togglePanel('users')}
                aria-expanded={isOpen}
                title={`${users.length} ${users.length === 1 ? 'person' : 'people'} in this room`}
            >
                <span className="room-users-dots">
                    {users.slice(0, MAX_DOTS).map((user) => (
                        <span key={user.clientId} className="room-user-dot" style={{ background: user.color }} />
                    ))}
                </span>
                <span>{users.length}</span>
            </button>

            {isOpen && (
                <div className="room-users-list" aria-label="People in this room">
                    {users.map((user) => (
                        <div key={user.clientId} className="room-user" title={user.isSelf ? 'This device' : user.name}>
                            <span className="room-user-dot" style={{ background: user.color }} />
                            <span>{user.name}{user.isSelf && <span className="room-user-self"> (you)</span>}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
