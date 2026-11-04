import { floorAt, floorElevation, levelBounds } from '../plan/planModel.js';
import { canLand } from '../components/scene/xr-ui/teleport.js';

/*
* Where a piece of furniture added from the "+" menu goes (plan U5, R1): the floor point at the center of
* the view (`ground`, [x, z] board meters, null when the view center misses the floor plane), if it is on a
* drawn floor and outside the walls (the teleport's rule, canLand); otherwise the center of the plan.
* Returns [x, y, z]: y = the top of the floor there.
*/
export function spawnPoint(level, ground) {
    const point = ground != null && canLand(level, ground) ? ground : levelBounds(level).center;
    const floor = floorAt(level, point);
    return [point[0], floor ? floorElevation(floor) : 0, point[1]];
}

// A piece dragged out of the catalog (store modelDrag): lands at `ground` only where spawnPoint would keep it, else null
export const dropPoint = (level, ground) => (ground != null && canLand(level, ground) ? spawnPoint(level, ground) : null);
