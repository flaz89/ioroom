import { useRoomUsers } from '../../../sync/presence';
import './room-users.css';

/*
* People in the shared room (top left): one pill per device, with its presence color (the same color
* outlines the objects it is holding). This device comes first, marked "you". Hidden without a room.
* Names are device types for now (sync/presence.js deviceName); accounts will replace them.
*/
export default function RoomUsers() {
    const users = useRoomUsers();
    if (users.length === 0) return null;

    return (
        <div className="room-users" aria-label="People in this room">
            {users.map((user) => (
                <div key={user.clientId} className="room-user" title={user.isSelf ? 'This device' : user.name}>
                    <span className="room-user-dot" style={{ background: user.color }} />
                    <span>{user.name}{user.isSelf && <span className="room-user-self"> (you)</span>}</span>
                </div>
            ))}
        </div>
    );
}
