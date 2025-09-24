import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

async function main() {
    await RAPIER.init();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xaaaaaa);
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 0);
    camera.lookAt(0, 0, -5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0x404040, 5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
    directionalLight.position.set(2, 5, 5);
    scene.add(directionalLight);

    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    const world = new RAPIER.World(gravity);
    let allObjects = [];
    let placementMatrix = new THREE.Matrix4(); // Re-introduce placement matrix

    const globalScale = 1.0 / 1.9;
    const loader = new GLTFLoader();

    const [laneGltf, pinGltf, ballGltf] = await Promise.all([
        loader.loadAsync('3d/lane.glb'),
        loader.loadAsync('3d/pin.glb'),
        loader.loadAsync('3d/ball.glb')
    ]);

    // Process Lane
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
            // We don't add the lane to allObjects because its position is static relative to the placementMatrix
        }
    });

    // Process Pin
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
        const pinBox = new THREE.Box3().setFromObject(pinMesh);
        const pinSize = pinBox.getSize(new THREE.Vector3());
        const initialPosition = { x: x, y: pinSize.y / 2, z: z };
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

    // Process Ball
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

    // Animation Loop
    function animate() {
        world.step();

        // Update all dynamic objects
        allObjects.forEach(obj => {
            const physicsMatrix = new THREE.Matrix4().compose(
                obj.body.translation(),
                obj.body.rotation(),
                new THREE.Vector3(1, 1, 1)
            );
            // Apply the placement matrix to the physics transform
            const finalMatrix = new THREE.Matrix4().multiplyMatrices(placementMatrix, physicsMatrix);
            obj.mesh.position.setFromMatrixPosition(finalMatrix);
            obj.mesh.quaternion.setFromRotationMatrix(finalMatrix);
        });

        // The lane is static, its position is determined solely by the placement matrix
        laneMesh.position.setFromMatrixPosition(placementMatrix);
        laneMesh.quaternion.setFromRotationMatrix(placementMatrix);

        renderer.render(scene, camera);
    }
    renderer.setAnimationLoop(animate);

    // Session Start: Place the scene on the floor
    renderer.xr.addEventListener('sessionstart', () => {
        const xrCamera = renderer.xr.getCamera();
        const userHeight = xrCamera.position.y > 0.1 ? xrCamera.position.y : 1.6;
        placementMatrix.makeTranslation(0, -userHeight, -2); // Place 2m in front, on the floor
    });

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    document.body.appendChild(ARButton.createButton(renderer));
}

main();
