import { objectsList } from '../../../store/slices/objectsSlice';
import { objectIcons } from './objectIcons';
import VRButton from './VRButton';

const COLUMNS = 4;
const ICON_SIZE = 0.03;          // meters, square icon buttons
const CELL = ICON_SIZE + 0.005;  // meters between cells (button + gap)

/*
* In-VR catalog: one icon button per entry of the objects catalog (same list as the desktop ObjectsMenu).
* Entries without an icon fall back to their name. onPick(type) is called with the chosen object type.
*/
export default function VRCatalogPanel({ onPick, ...groupProps }) {
    const rows = Math.ceil(objectsList.length / COLUMNS);
    return (
        <group {...groupProps}>
            {objectsList.map((item, index) => {
                const column = index % COLUMNS;
                const row = Math.floor(index / COLUMNS);
                return (
                    <VRButton
                        key={item.type}
                        icon={objectIcons[item.type]}
                        label={item.name}
                        size={[ICON_SIZE, ICON_SIZE]}
                        onClick={() => onPick(item.type)}
                        // first item top-left, grid centered on the group origin
                        position={[(column - (COLUMNS - 1) / 2) * CELL, ((rows - 1) / 2 - row) * CELL, 0]}
                    />
                );
            })}
        </group>
    );
}
