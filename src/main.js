import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARButton } from 'three/addons/webxr/ARButton.js';

async function main() {
    await RAPIER.init();

    // 1. Scene Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xaaaaaa);

    // Physics World
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    const world = new RAPIER.World(gravity);

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 0); // Position at user height, looking forward
    camera.lookAt(0, 0, -5);

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    // 4. Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
    directionalLight.position.set(2, 5, 5);
    scene.add(directionalLight);

    // 5. Create Game Elements
    const globalScale = 1.0 / 1.9;
    let allObjects = []; // To hold all physics-enabled objects

    // Create Lane
    const laneWidth = 1.07 * globalScale;
    const laneLength = 18.29 * globalScale;
    const laneHeight = 0.1 * globalScale;
    const groundGeometry = new THREE.BoxGeometry(laneWidth, laneHeight, laneLength);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x806040 });
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.position.y = -laneHeight / 2; // Position it so top surface is at y=0
    scene.add(groundMesh);

    // Create a fixed rigid body for the ground
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -laneHeight / 2, 0);
    const groundBody = world.createRigidBody(groundBodyDesc);
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(laneWidth / 2, laneHeight / 2, laneLength / 2);
    world.createCollider(groundColliderDesc, groundBody);
    allObjects.push({ mesh: groundMesh, body: groundBody });

    // Create Pins
    const pinHeight = 0.38 * globalScale;
    const pinRadius = 0.06 * globalScale;
    const pinGeometry = new THREE.CapsuleGeometry(pinRadius, pinHeight - (pinRadius * 2), 16);
    const pinMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });

    function createPin(x, z) {
        const pinMesh = new THREE.Mesh(pinGeometry, pinMaterial.clone());
        const colliderCenterY = pinHeight / 2;
        const initialPosition = { x: x, y: colliderCenterY, z: z };

        pinMesh.position.set(initialPosition.x, initialPosition.y, initialPosition.z);
        scene.add(pinMesh);

        const pinBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(initialPosition.x, initialPosition.y, initialPosition.z);
        const pinBody = world.createRigidBody(pinBodyDesc);
        const capsule = RAPIER.ColliderDesc.capsule((pinHeight - (pinRadius * 2)) / 2, pinRadius);
        world.createCollider(capsule, pinBody);
        allObjects.push({ mesh: pinMesh, body: pinBody });
    }

    // Layout pins in a triangle
    const pinSpacing = 0.2 * globalScale;
    const pinStartZ = -(laneLength / 2) + 2;
    for (let row = 0; row < 4; row++) {
        for (let i = 0; i < row + 1; i++) {
            const x = (i - row / 2) * pinSpacing * 2;
            const z = pinStartZ - row * pinSpacing * 1.732;
            createPin(x, z);
        }
    }

    // 6. Animation Loop
    function animate() {
        world.step();

        // Update all object positions from physics simulation
        allObjects.forEach(obj => {
            obj.mesh.position.copy(obj.body.translation());
            obj.mesh.quaternion.copy(obj.body.rotation());
        });

        renderer.render(scene, camera);
    }

    renderer.setAnimationLoop(animate);

    // 7. Handle Window Resizing
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Add AR Button
    document.body.appendChild(ARButton.createButton(renderer));
}

main();
