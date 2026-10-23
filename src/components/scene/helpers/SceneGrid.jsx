import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { Grid } from '@react-three/drei';
import { useStore } from '../../../store/appStore';
import { activeLevel, sceneBounds } from '../../../plan/planModel';

/*
* Floor grid for both renderers.
* - WebGL  -> drei <Grid> (GLSL shader with distance fade).
* - WebGPU -> three's GridHelper (built-in line material, WebGPU compatible). Same size, cell and
*   section colors, but without the distance fade.
* SIZED FROM THE PROJECT (planModel.sceneBounds: plan + underlay drawing): a square of at least MIN_SIZE,
* grown to hold the project with a margin, in whole sections, centered on it but snapped to the section
* step (its lines stay on the world's round meters whatever the project).
* ponytail: no fade on WebGPU; port drei's grid shader to TSL if the visual difference matters.
*/
const MIN_SIZE = 20;    // meters
const MARGIN = 4;       // meters around the project
const CELL_SIZE = 0.5;  // meters
const SECTION = 2;      // meters
const GRID_DROP = 0.03; // meters below the floor plane (WebGPU grid, see below)
export default function SceneGrid({ visible }) {
    const isWebGPU = useThree((state) => state.gl.isWebGPURenderer === true);
    const level = useStore((state) => activeLevel(state.plan));
    const { size, center } = useMemo(() => {
        const bounds = sceneBounds(level);
        const extent = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]) + 2 * MARGIN;
        const snap = (v) => Math.round(v / SECTION) * SECTION;
        return { size: Math.max(MIN_SIZE, Math.ceil(extent / (2 * SECTION)) * 2 * SECTION), center: [snap(bounds.center[0]), snap(bounds.center[1])] };
    }, [level]);
    const SIZE = size;

    if (isWebGPU) {
        // Below y=0 so the room floor hides it, as drei's Grid does on WebGL (avoids z-fighting). GRID_DROP, not
        // a hair: the overlay pass depth-tests it against the opaque pass, whose depth is rendered with TRAA's
        // sub-pixel jitter; on a floor seen at a grazing angle that shifts the depth by more than a few mm.
        // transparent material (fully opaque look): drawn in the post-processing's overlay pass
        // (PostEffects.jsx), sharp and stable, not through SSGI / TRAA (which faded and flickered its thin lines)
        return (
            <gridHelper args={[SIZE, SIZE / CELL_SIZE, '#888888', '#555555']} position={[center[0], -GRID_DROP, center[1]]} visible={visible}
                material-transparent />
        );
    }
    return (
        <Grid
            args={[SIZE, SIZE]}
            position={[center[0], 0, center[1]]}
            cellSize={CELL_SIZE}
            cellThickness={.5}
            cellColor="#555555"
            sectionSize={SECTION}
            sectionThickness={1}
            sectionColor="#888888"
            fadeDistance={Math.max(25, SIZE * 1.25)}
            fadeStrength={1}
            followCamera={false}
            infiniteGrid={false}
            visible={visible}
        />
    );
}
