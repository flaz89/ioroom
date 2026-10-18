import { SYNC_HOST, isAdmin, useRoomStatus } from '../../../sync/roomSync';
import './room-notice.css';

// Messages for the shared-room states a guest can end up in (see sync/roomSync.js)
const MESSAGES = {
    local: 'Local mode: changes are not saved. Open a room link shared by the owner to join a project.',
    'not-found': 'This room does not exist. Ask the owner for a valid link.',
    elsewhere: 'This room is open in another tab on this device. Reload this page to use it here.',
    adminLocal: 'Local mode: changes are not saved. Open or create an environment from "My environments".'
};

/*
* Small banner at the top center explaining why the scene is not shared: no room in the URL (guests
* cannot create rooms), a room link that does not exist, or the room taken over by another tab of this
* browser. Hidden when connected or without sync.
*/
export default function RoomNotice() {
    const status = useRoomStatus();
    // The owner opens or creates environments from the "My environments" toolbar button
    const message = isAdmin && status === 'local' ? MESSAGES.adminLocal : MESSAGES[status];
    if (!SYNC_HOST || message == null) return null;
    return <div className="room-notice" role="status">{message}</div>;
}
