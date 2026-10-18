import { useThree } from '@react-three/fiber';
import { Grid } from '@react-three/drei';

/*
* Floor grid for both renderers.
* - WebGL  -> drei <Grid> (GLSL shader with distance fade).
* - WebGPU -> three's GridHelper (built-in line material, WebGPU compatible). Same size, cell and
*   section colors, but without the distance fade.
* ponytail: no fade on WebGPU; port drei's grid shader to TSL if the visual difference matters.
*/
const SIZE = 20;        // meters
const CELL_SIZE = 0.5;  // meters
export default function SceneGrid({ visible }) {
    const isWebGPU = useThree((state) => state.gl.isWebGPURenderer === true);

    if (isWebGPU) {
        // Slightly below y=0 so the room floor hides it, as drei's Grid does on WebGL (avoids z-fighting)
        return <gridHelper args={[SIZE, SIZE / CELL_SIZE, '#888888', '#555555']} position-y={-0.005} visible={visible} />;
    }
    return (
        <Grid
            args={[SIZE, SIZE]}
            cellSize={CELL_SIZE}
            cellThickness={.5}
            cellColor="#555555"
            sectionSize={2}
            sectionThickness={1}
            sectionColor="#888888"
            fadeDistance={25}
            fadeStrength={1}
            followCamera={false}
            infiniteGrid={false}
            visible={visible}
        />
    );
}
