import { SYNC_HOST, useRoomStatus } from '../../../sync/roomSync';
import './room-notice.css';

// Messages for the shared-room states a guest can end up in (see sync/roomSync.js)
const MESSAGES = {
    local: 'Local mode: changes are not saved. Open a room link shared by the owner to join a project.',
    'not-found': 'This room does not exist. Ask the owner for a valid link.'
};

/*
* Small banner at the top center explaining why the scene is not shared: no room in the URL (guests
* cannot create rooms) or a room link that does not exist. Hidden when connected or without sync.
*/
export default function RoomNotice() {
    const status = useRoomStatus();
    const message = MESSAGES[status];
    if (!SYNC_HOST || message == null) return null;
    return <div className="room-notice" role="status">{message}</div>;
}
