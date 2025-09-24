import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

async function main() {
    await RAPIER.init();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xaaaaaa);

    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    const world = new RAPIER.World(gravity);

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

    const globalScale = 1.0 / 1.9;
    const loader = new GLTFLoader();
    let dynamicObjects = [];
    let placementMatrix = new THREE.Matrix4();

    // Load all models first
    const [laneGltf, pinGltf, ballGltf] = await Promise.all([
        loader.loadAsync('3d/lane.glb'),
        loader.loadAsync('3d/pin.glb'),
        loader.loadAsync('3d/ball.glb')
    ]);

    // Setup Lane
    const laneMesh = laneGltf.scene;
    laneMesh.scale.setScalar(globalScale);
    scene.add(laneMesh);
    const groundMesh = laneMesh; // Define groundMesh
    groundMesh.visible = false; // Set initial visibility
    let groundBody;
    groundMesh.traverse(child => {
        if (child.isMesh) {
            const vertices = child.geometry.attributes.position.array.slice();
            const indices = child.geometry.index.array;
            for (let i = 0; i < vertices.length; i++) { vertices[i] *= globalScale; }
            const trimeshDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
            groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
            world.createCollider(trimeshDesc, groundBody);
        }
    });

    // Setup Pins
    const pinModel = pinGltf.scene;
    pinModel.scale.setScalar(globalScale);
    let pinVertices, pinIndices;
    pinModel.traverse(child => {
        if (child.isMesh) {
            pinVertices = child.geometry.attributes.position.array.slice();
            pinIndices = child.geometry.index.array;
            for (let i = 0; i < pinVertices.length; i++) { pinVertices[i] *= globalScale; }
        }
    });
    const pinColliderDesc = RAPIER.ColliderDesc.trimesh(pinVertices, pinIndices);

    function createPin(x, z) {
        const pinMesh = pinModel.clone();
        const pinBox = new THREE.Box3().setFromObject(pinMesh);
        const pinHeight = pinBox.getSize(new THREE.Vector3()).y;
        const initialPosition = { x: x, y: pinHeight / 2, z: z };

        const pinBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(initialPosition.x, initialPosition.y, initialPosition.z);
        const pinBody = world.createRigidBody(pinBodyDesc);
        world.createCollider(pinColliderDesc, pinBody);

        scene.add(pinMesh);
        pinMesh.visible = false; // Set initial visibility
        dynamicObjects.push({ mesh: pinMesh, body: pinBody });
    }

    const pinSpacing = 0.2 * globalScale;
    const laneLength = 18.29 * globalScale;
    const pinStartZ = -(laneLength / 2) + 4; // Moved closer
    for (let row = 0; row < 4; row++) {
        for (let i = 0; i < row + 1; i++) {
            createPin((i - row / 2) * pinSpacing * 2, pinStartZ - row * pinSpacing * 1.732);
        }
    }

    // Setup Ball
    const ballMesh = ballGltf.scene;
    ballMesh.scale.setScalar(globalScale);
    const ballBox = new THREE.Box3().setFromObject(ballMesh);
    const ballRadius = ballBox.getSize(new THREE.Vector3()).x / 2;
    const ballInitialPosition = { x: 0, y: ballRadius + 0.1, z: (laneLength / 2) - 1 };
    const ballBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(ballInitialPosition.x, ballInitialPosition.y, ballInitialPosition.z);
    const ballBody = world.createRigidBody(ballBodyDesc);
    const ballColliderDesc = RAPIER.ColliderDesc.ball(ballRadius);
    world.createCollider(ballColliderDesc, ballBody);
    scene.add(ballMesh);
    ballMesh.visible = false; // Set initial visibility
    dynamicObjects.push({ mesh: ballMesh, body: ballBody, isBall: true });

    // Animation Loop
    function animate() {
        if (groundBody) {
            const position = new THREE.Vector3().setFromMatrixPosition(placementMatrix);
            const quaternion = new THREE.Quaternion().setFromRotationMatrix(placementMatrix);
            groundBody.setNextKinematicTranslation(position);
            groundBody.setNextKinematicRotation(quaternion);
        }
        world.step();
        dynamicObjects.forEach(obj => {
            const finalMatrix = new THREE.Matrix4().multiplyMatrices(placementMatrix, new THREE.Matrix4().compose(obj.body.translation(), obj.body.rotation(), {x:1,y:1,z:1}));
            obj.mesh.position.setFromMatrixPosition(finalMatrix);
            obj.mesh.quaternion.setFromRotationMatrix(finalMatrix);
        });
        groundMesh.position.setFromMatrixPosition(placementMatrix);
        groundMesh.quaternion.setFromRotationMatrix(placementMatrix);
        renderer.render(scene, camera);
    }
    renderer.setAnimationLoop(animate);

    // Session Start
    renderer.xr.addEventListener('sessionstart', () => {
        groundMesh.visible = true;
        dynamicObjects.forEach(obj => { obj.mesh.visible = true; });

        const xrCamera = renderer.xr.getCamera();
        const userHeight = xrCamera.position.y > 0.1 ? xrCamera.position.y : 1.6;
        placementMatrix.makeTranslation(0, -userHeight, -2);
    });

    // Dummy onSelect for completeness, though it's not used in this version
    function onSelect() {}
    const controller1 = renderer.xr.getController(0);
    controller1.addEventListener('select', onSelect);
    scene.add(controller1);

    document.body.appendChild(ARButton.createButton(renderer, { requiredFeatures: ['local-floor'] }));
}

main();
