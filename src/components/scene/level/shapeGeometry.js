import * as THREE from 'three';

// Shared geometries of the basic shapes (ObjectGhost.jsx, VR catalog miniatures): same shapes (default sizes) as SingleObject's renderGeometry
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
export function shapeOf(type) {
    const key = FACTORIES[type] ? type : 'boxGeometry';
    if (!shapes.has(key)) shapes.set(key, FACTORIES[key]());
    return shapes.get(key);
}
