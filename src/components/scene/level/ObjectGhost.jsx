import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { abs, dot, float, normalView, positionViewDirection, pow, uniform } from 'three/tsl';

/*
* Frozen "hologram" of a furniture object, drawn instead of SingleObject in the builder (ObjectRenderer.jsx):
* the furniture is not editable while the environment is built, and this makes it visible at a glance.
* - Body: unlit orange, see-through in the middle and glowing at the silhouette (FRESNEL: opacity grows as
*   the surface turns away from the eye). Additive blending, no depth write, no shadows: cheaper than the
*   lit material. Two versions, same look: TSL node material on WebGPU, a tiny GLSL ShaderMaterial on WebGL
*   (each renderer only understands its own; same split as SelectionOutline.jsx).
* - Faces lying on the floor (bottom of a box, cylinder...) are coplanar with it and would z-fight: the
*   hologram is drawn with a POLYGON OFFSET (depth pulled towards the camera, both renderers), so it always
*   wins against the surface it rests on, at any distance, without moving the object.
* - Not interactive: pointerEvents "none" (no hover, no cursor, no clicks; the walls get them).
* Geometries and materials are SHARED (one per geometry type / renderer, built on first use, kept).
*/
const HOLOGRAM_COLOR = new THREE.Color('#ff9a1a');
const BASE_OPACITY = 0.06;     // facing the eye
const RIM_OPACITY = 0.7;       // added at the silhouette
const RIM_POWER = 2.5;         // higher = thinner glowing rim
// Depth bias against coplanar surfaces (floor under the object): negative = towards the camera
const DEPTH_OFFSET = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };

// WebGPU: fresnel in TSL
let nodeMaterial = null;
function hologramNodeMaterial() {
    if (nodeMaterial) return nodeMaterial;
    nodeMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, ...DEPTH_OFFSET });
    const facing = abs(dot(normalView, positionViewDirection));          // 1 facing the eye, 0 at the silhouette
    const rim = pow(float(1).sub(facing), RIM_POWER);
    nodeMaterial.colorNode = uniform(HOLOGRAM_COLOR);
    nodeMaterial.opacityNode = rim.mul(RIM_OPACITY).add(BASE_OPACITY);
    return nodeMaterial;
}

// WebGL: same fresnel in GLSL
let glslMaterial = null;
function hologramGlslMaterial() {
    if (glslMaterial) return glslMaterial;
    glslMaterial = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, ...DEPTH_OFFSET,
        uniforms: { color: { value: HOLOGRAM_COLOR }, base: { value: BASE_OPACITY }, rim: { value: RIM_OPACITY }, power: { value: RIM_POWER } },
        vertexShader: /* glsl */`
            varying vec3 vNormal;
            varying vec3 vViewDir;
            void main() {
                vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
                vNormal = normalize(normalMatrix * normal);
                vViewDir = normalize(-viewPosition.xyz);
                gl_Position = projectionMatrix * viewPosition;
            }`,
        fragmentShader: /* glsl */`
            uniform vec3 color;
            uniform float base;
            uniform float rim;
            uniform float power;
            varying vec3 vNormal;
            varying vec3 vViewDir;
            void main() {
                float facing = abs(dot(normalize(vNormal), normalize(vViewDir)));
                gl_FragColor = vec4(color, base + rim * pow(1.0 - facing, power));
            }`
    });
    return glslMaterial;
}

// Same shapes (default sizes) as SingleObject's renderGeometry
const FACTORIES = {
    boxGeometry: () => new THREE.BoxGeometry(),
    planeGeometry: () => new THREE.PlaneGeometry(),
    sphereGeometry: () => new THREE.SphereGeometry(),
    capsuleGeometry: () => new THREE.CapsuleGeometry(),
    cylinderGeometry: () => new THREE.CylinderGeometry(),
    circleGeometry: () => new THREE.CircleGeometry(),
    donutGeometry: () => new THREE.TorusGeometry(),
    knotGeometry: () => new THREE.TorusKnotGeometry()
};
const shapes = new Map(); // geometry type -> geometry
function shapeOf(type) {
    const key = FACTORIES[type] ? type : 'boxGeometry';
    if (!shapes.has(key)) shapes.set(key, FACTORIES[key]());
    return shapes.get(key);
}

export default function ObjectGhost({ data }) {
    const isWebGPU = useThree((state) => state.gl.isWebGPURenderer === true);
    const body = shapeOf(data.geometryType);
    return (
        <group position={data.position} rotation={data.rotation} scale={data.scale} pointerEvents="none">
            <mesh geometry={body} material={isWebGPU ? hologramNodeMaterial() : hologramGlslMaterial()} dispose={null} />
        </group>
    );
}
