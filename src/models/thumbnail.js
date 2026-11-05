import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/*
* Catalog thumbnail of an uploaded model (plan U4, KTD8), rendered in the browser: a one-off WebGL renderer
* (its own small context, disposed at once), studio light (RoomEnvironment) + a key light, a three-quarter
* view from the front that frames the whole piece, transparent background (shown on the menu's dark glass).
* mesh: { geometry, materials } (models/inspectGlb.js). Resolves with a WebP Blob (PNG where the browser
* cannot encode WebP, e.g. Safari; the server takes both).
*/
const SIZE = 256;          // px of the thumbnail
const SUPERSAMPLE = 2;     // rendered at 2x, then downscaled: smooth edges
const VIEW = new THREE.Vector3(1, 0.75, 1.6).normalize(); // camera direction from the piece (front, right, above)
const FOV = 30;
const EXPOSURE = 0.8;
const KEY_LIGHT = 1;
const ENVIRONMENT = 0.5; // studio light: at 1 light pieces still looked much paler than in the room

export async function renderThumbnail({ geometry, materials }) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    try {
        renderer.setPixelRatio(SUPERSAMPLE);
        renderer.setSize(SIZE, SIZE, false);
        // Neutral + lower exposure: ACES at 1 with a 1.5 key burned light textures (travertine) to plain white
        renderer.toneMapping = THREE.NeutralToneMapping;
        renderer.toneMappingExposure = EXPOSURE;
        const scene = new THREE.Scene();
        const pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environmentIntensity = ENVIRONMENT;
        const key = new THREE.DirectionalLight('#ffffff', KEY_LIGHT);
        key.position.set(2, 4, 3);
        scene.add(key, new THREE.Mesh(geometry, materials));

        const sphere = geometry.boundingSphere;
        const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100);
        const distance = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(FOV / 2))) * 1.05;
        camera.position.copy(sphere.center).addScaledVector(VIEW, distance);
        camera.lookAt(sphere.center);
        renderer.render(scene, camera);

        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SIZE;
        const context = canvas.getContext('2d');
        context.imageSmoothingQuality = 'high';
        context.drawImage(renderer.domElement, 0, 0, SIZE, SIZE);
        scene.environment.dispose();
        pmrem.dispose();
        return await new Promise((resolve, reject) => canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('Thumbnail not rendered'))), 'image/webp', 0.9));
    } finally {
        renderer.dispose();
        renderer.forceContextLoss();
    }
}
