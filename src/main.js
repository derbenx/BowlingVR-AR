import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

async function main() {
    await RAPIER.init();

    // 1. Scene Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xaaaaaa);
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 0);
    camera.lookAt(0, 0, -5);

    // 2. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    // 3. Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
    directionalLight.position.set(2, 5, 5);
    scene.add(directionalLight);

    // 4. Physics World
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    const world = new RAPIER.World(gravity);
    let allObjects = [];

    // 5. Load all models first
    const globalScale = 1.0 / 1.9;
    const loader = new GLTFLoader();

    const [laneGltf, pinGltf, ballGltf] = await Promise.all([
        loader.loadAsync('3d/lane.glb'),
        loader.loadAsync('3d/pin.glb'),
        loader.loadAsync('3d/ball.glb')
    ]);

    // 6. Process models and create physics bodies
    // Lane
    const laneMesh = laneGltf.scene;
    laneMesh.scale.setScalar(globalScale);
    scene.add(laneMesh);
    laneMesh.traverse(child => {
        if (child.isMesh) {
            const vertices = child.geometry.attributes.position.array;
            const indices = child.geometry.index.array;
            const scaledVertices = new Float32Array(vertices.length);
            for (let i = 0; i < vertices.length; i++) {
                scaledVertices[i] = vertices[i] * globalScale;
            }
            const trimeshDesc = RAPIER.ColliderDesc.trimesh(scaledVertices, indices);
            const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
            world.createCollider(trimeshDesc, groundBody);
            allObjects.push({ mesh: laneMesh, body: groundBody }); // Use laneMesh, not child
        }
    });

    // Pin
    const pinModel = pinGltf.scene;
    pinModel.scale.setScalar(globalScale);
    let pinVertices, pinIndices;
    pinModel.traverse(child => {
        if (child.isMesh) {
            pinVertices = child.geometry.attributes.position.array;
            pinIndices = child.geometry.index.array;
        }
    });
    const scaledPinVertices = new Float32Array(pinVertices.length);
    for (let i = 0; i < pinVertices.length; i++) {
        scaledPinVertices[i] = pinVertices[i] * globalScale;
    }

    function createPin(x, z) {
        const pinMesh = pinModel.clone();
        const initialPosition = { x: x, y: 0, z: z };
        pinMesh.position.set(initialPosition.x, initialPosition.y, initialPosition.z);
        scene.add(pinMesh);
        const pinBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(initialPosition.x, initialPosition.y, initialPosition.z);
        const pinBody = world.createRigidBody(pinBodyDesc);
        const pinColliderDesc = RAPIER.ColliderDesc.trimesh(scaledPinVertices, pinIndices);
        world.createCollider(pinColliderDesc, pinBody);
        allObjects.push({ mesh: pinMesh, body: pinBody });
    }

    const pinSpacing = 0.2 * globalScale;
    const laneLength = 18.29 * globalScale;
    const pinStartZ = -(laneLength / 2) + 2;
    for (let row = 0; row < 4; row++) {
        for (let i = 0; i < row + 1; i++) {
            const x = (i - row / 2) * pinSpacing * 2;
            const z = pinStartZ - row * pinSpacing * 1.732;
            createPin(x, z);
        }
    }

    // Ball
    const ballMesh = ballGltf.scene;
    ballMesh.scale.setScalar(globalScale);
    const ballInitialPosition = { x: 0, y: 0.2, z: 8 * globalScale };
    ballMesh.position.set(ballInitialPosition.x, ballInitialPosition.y, ballInitialPosition.z);
    scene.add(ballMesh);
    const ballBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(ballInitialPosition.x, ballInitialPosition.y, ballInitialPosition.z);
    const ballBody = world.createRigidBody(ballBodyDesc);
    const ballColliderDesc = RAPIER.ColliderDesc.ball(0.109 * globalScale);
    world.createCollider(ballColliderDesc, ballBody);
    allObjects.push({ mesh: ballMesh, body: ballBody });

    // 7. Animation Loop
    function animate() {
        world.step();
        allObjects.forEach(obj => {
            obj.mesh.position.copy(obj.body.translation());
            obj.mesh.quaternion.copy(obj.body.rotation());
        });
        renderer.render(scene, camera);
    }
    renderer.setAnimationLoop(animate);

    // 8. Resize Listener
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // 9. AR Button
    document.body.appendChild(ARButton.createButton(renderer));
}

main();
