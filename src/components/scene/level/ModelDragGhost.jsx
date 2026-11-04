import { useStore } from '../../../store/appStore';
import { SHAPE_LIFT, objectsList } from '../../../store/slices/objectsSlice';
import ObjectGhost from './ObjectGhost';

const ZERO = [0, 0, 0];
const ONE = [1, 1, 1];

// Full-size hologram of the piece (or basic shape) dragged out of the catalog (store modelDrag), where it would land; inside the Board
export default function ModelDragGhost() {
    const drag = useStore((state) => state.modelDrag);
    if (drag?.point == null) return null;
    if (drag.type != null) {
        const shape = objectsList.find((item) => item.type === drag.type);
        const [x, y, z] = drag.point;
        return <ObjectGhost data={{ geometryType: shape.geometryType, position: [x, y + SHAPE_LIFT, z], rotation: ZERO, scale: shape.defaultScale }} />;
    }
    return <ObjectGhost data={{ modelId: drag.model.id, variantId: drag.variantId, position: drag.point, rotation: ZERO, scale: ONE }} />;
}
