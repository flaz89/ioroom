import * as React from 'react';
import { Vector2, Vector3, Vector4 } from 'three';
import { useThree } from '@react-three/fiber';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Line2 as Line2WebGL } from 'three/addons/lines/Line2.js';
import { Line2 as Line2WebGPU } from 'three/addons/lines/webgpu/Line2.js';
import { Line2NodeMaterial } from 'three/webgpu';

/*
* Renderer-aware replacement for drei's <Line>, limited to the props PivotControls uses.
* - WebGLRenderer  -> Line2 + LineMaterial (GLSL), identical to drei's implementation.
* - WebGPURenderer -> Line2 + Line2NodeMaterial (TSL), the only wide-line material WebGPU can compile.
*
* Props are split explicitly between the Line2 object (transform, raycast, visibility, render order)
* and its material (color, opacity, depth/blending flags), instead of spreading everything on both.
*/

// Accepts a flat [x,y,z,...] array, Vector2/3/4 instances or [x,y(,z)] tuples
function toFlatPositions(points) {
    return points.flatMap((p) => {
        if (p instanceof Vector3 || p instanceof Vector4) return [p.x, p.y, p.z];
        if (p instanceof Vector2) return [p.x, p.y, 0];
        if (Array.isArray(p)) return [p[0], p[1], p[2] ?? 0];
        return p;
    });
}

export const Line = React.forwardRef(function Line({
    points,
    lineWidth = 1,
    color = 0xffffff,
    opacity = 1,
    transparent = false,
    depthTest = true,
    side,
    polygonOffset = false,
    polygonOffsetFactor = 0,
    fog,
    ...objectProps // position, raycast, visible, userData, renderOrder...
}, ref) {
    const isWebGPU = useThree((state) => state.gl.isWebGPURenderer === true);
    const size = useThree((state) => state.size);

    // Object + material are recreated only if the renderer type changes (i.e. Canvas remount)
    const [line, material] = React.useMemo(() => {
        const mat = isWebGPU ? new Line2NodeMaterial() : new LineMaterial();
        const obj = isWebGPU ? new Line2WebGPU(new LineGeometry(), mat) : new Line2WebGL(new LineGeometry(), mat);
        return [obj, mat];
    }, [isWebGPU]);

    // Geometry follows the points
    React.useLayoutEffect(() => {
        line.geometry.setPositions(toFlatPositions(points));
        line.computeLineDistances();
    }, [line, points]);

    // Material state is assigned imperatively: both materials expose the same Material/linewidth API
    React.useLayoutEffect(() => {
        material.color.set(color);
        material.linewidth = lineWidth;
        material.opacity = opacity;
        material.transparent = transparent;
        material.depthTest = depthTest;
        if (side !== undefined) material.side = side;
        material.polygonOffset = polygonOffset;
        material.polygonOffsetFactor = polygonOffsetFactor;
        if (fog !== undefined) material.fog = fog;
        if (material.isLineMaterial) material.resolution.set(size.width, size.height);
        material.needsUpdate = true;
    }, [material, color, lineWidth, opacity, transparent, depthTest, side, polygonOffset, polygonOffsetFactor, fog, size]);

    // The WebGPU LineSegments2 only updates its raycast resolution in onBeforeRender, which never runs
    // for invisible lines (PivotControls uses an invisible thick line as the rotator hit area).
    // Seed it with the canvas size so screen-space raycasting works from the first frame.
    // ponytail: touches a private field (_resolution); re-check on three.js upgrades.
    React.useLayoutEffect(() => {
        if (line._resolution) line._resolution.set(size.width, size.height);
    }, [line, size]);

    // Free GPU resources on unmount
    React.useEffect(() => () => {
        line.geometry.dispose();
        material.dispose();
    }, [line, material]);

    return <primitive object={line} ref={ref} {...objectProps} />;
});
