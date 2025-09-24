import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

async function main() {
    // 1. Scene Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 1); // Start at average eye-level, looking at the origin

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    // 4. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 2.0);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    // 5. Create Measurement Scene
    const loader = new GLTFLoader();

    // Use Promise.all to load both models concurrently
    const [ballGltf, pinGltf, laneGltf] = await Promise.all([
        loader.loadAsync('3d/ball.glb'),
        loader.loadAsync('3d/pin.glb'),
        loader.loadAsync('3d/lane.glb')
    ]);

    // --- Lane for Measurement ---
    const laneMesh = laneGltf.scene;
    scene.add(laneMesh);

    // --- Ball for Measurement ---
    const ballModel = ballGltf.scene;
    ballModel.position.set(0.5, 0, 0); // Place at x=0.5, on the floor
    scene.add(ballModel);

    // --- Pin for Measurement ---
    const pinModel = pinGltf.scene;
    pinModel.position.set(-0.5, 0, 0); // Place at x=-0.5, on the floor
    scene.add(pinModel);


    // 6. Animation Loop
    function animate() {
        renderer.render(scene, camera);
    }

    renderer.setAnimationLoop(animate);

    // --- VR Button ---
    document.body.appendChild(ARButton.createButton(renderer));
}

main();
