import { getRoomUsers, remoteAvatars } from '../../../sync/presence';
import { headingOf } from '../../../plan/minimap';

/*
* The other players to show on the minimaps (Minimap.jsx, VRMinimap.jsx): every other device with a head in the
* room (presence avatars: headset users and first / third person walkers), in their color. Only those at life
* size (avatar scale 1): a tabletop user leans over a scale model, not inside the plan. Read every frame.
* -> [{ x, z, yaw, color }] (plan meters).
*/
export function otherPlayers() {
    const players = [];
    for (const user of getRoomUsers()) {
        if (user.isSelf || user.away) continue;
        const head = remoteAvatars.get(user.clientId)?.h;
        if (head == null || Math.abs(remoteAvatars.get(user.clientId).s - 1) > 0.01) continue;
        players.push({ x: head[0], z: head[2], yaw: headingOf(head.slice(3, 7)), color: user.color });
    }
    return players;
}
