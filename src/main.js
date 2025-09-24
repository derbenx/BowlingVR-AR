import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

async function main() {
    await RAPIER.init();

    // Basic setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
    directionalLight.position.set(2, 5, 5);
    scene.add(directionalLight);

    // Physics
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    const world = new RAPIER.World(gravity);

    // Game variables
    let dynamicObjects = [];
    let placementMatrix = new THREE.Matrix4();
    let controllerGrip1, controllerGrip2;
    const controllerVelocity = new THREE.Vector3();
    let lastControllerPosition = new THREE.Vector3();
    let lastTimestamp = 0;
    let gameReady = false; // Simplified state: false until placed, then true

    // Load assets
    const globalScale = 1.0 / 1.9;
    const loader = new GLTFLoader();
    const [laneGltf, pinGltf, ballGltf] = await Promise.all([
        loader.loadAsync('3d/lane.glb'),
        loader.loadAsync('3d/pin.glb'),
        loader.loadAsync('3d/ball.glb')
    ]);

    // Setup Lane
    const laneMesh = laneGltf.scene;
    laneMesh.scale.setScalar(globalScale);
    scene.add(laneMesh);
    laneMesh.traverse(child => {
        if (child.isMesh) {
            const vertices = child.geometry.attributes.position.array;
            const indices = child.geometry.index.array;
            const scaledVertices = new Float32Array(vertices.length);
            for (let i = 0; i < vertices.length; i++) { scaledVertices[i] = vertices[i] * globalScale; }
            const trimeshDesc = RAPIER.ColliderDesc.trimesh(scaledVertices, indices);
            world.createCollider(trimeshDesc, world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
        }
    });

    // Setup Pin factory
    const pinModel = pinGltf.scene;
    pinModel.scale.setScalar(globalScale);
    let pinVertices, pinIndices;
    pinModel.traverse(child => { if (child.isMesh) { pinVertices = child.geometry.attributes.position.array; pinIndices = child.geometry.index.array; } });
    const scaledPinVertices = new Float32Array(pinVertices.length);
    for (let i = 0; i < pinVertices.length; i++) { scaledPinVertices[i] = pinVertices[i] * globalScale; }

    function createPin(x, z) {
        const pinMesh = pinModel.clone();
        const pinBox = new THREE.Box3().setFromObject(pinMesh);
        const pinSize = pinBox.getSize(new THREE.Vector3());
        const initialPosition = { x: x, y: pinSize.y / 2, z: z };
        pinMesh.position.set(initialPosition.x, initialPosition.y, initialPosition.z);
        scene.add(pinMesh);
        const pinBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(initialPosition.x, initialPosition.y, initialPosition.z);
        const pinBody = world.createRigidBody(pinBodyDesc);
        pinBody.setGravityScale(0.0, true); // Gravity off until placed
        const pinColliderDesc = RAPIER.ColliderDesc.trimesh(scaledPinVertices, pinIndices);
        world.createCollider(pinColliderDesc, pinBody);
        dynamicObjects.push({ mesh: pinMesh, body: pinBody, initialPosition: initialPosition, isPin: true });
    }

    const pinSpacing = 0.2 * globalScale;
    const laneLength = 18.29 * globalScale;
    const pinStartZ = -(laneLength / 2) + 2;
    for (let row = 0; row < 4; row++) { for (let i = 0; i < row + 1; i++) { createPin((i - row / 2) * pinSpacing * 2, pinStartZ - row * pinSpacing * 1.732); } }

    // Setup Ball
    const ballMesh = ballGltf.scene;
    ballMesh.scale.setScalar(globalScale);
    const ballInitialPosition = { x: 0, y: 0.15, z: (laneLength / 2) - 1 };
    ballMesh.position.set(ballInitialPosition.x, ballInitialPosition.y, ballInitialPosition.z);
    scene.add(ballMesh);
    const ballBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(ballInitialPosition.x, ballInitialPosition.y, ballInitialPosition.z);
    const ballBody = world.createRigidBody(ballBodyDesc);
    ballBody.setGravityScale(0.0, true); // Gravity off until thrown
    const ballColliderDesc = RAPIER.ColliderDesc.ball(0.109 * globalScale);
    world.createCollider(ballColliderDesc, ballBody);
    dynamicObjects.push({ mesh: ballMesh, body: ballBody, initialPosition: ballInitialPosition, isBall: true });

    // --- Game Logic ---

    function onSelect() {
        const ball = dynamicObjects.find(obj => obj.isBall);
        if (gameReady && !ball.mesh.parent) {
            // If ball is not held, re-attach it for another throw (simple reset)
            controllerGrip1.add(ball.mesh);
            ball.body.setTranslation(ball.initialPosition, true);
            ball.body.setLinvel({x:0,y:0,z:0}, true);
            ball.body.setAngvel({x:0,y:0,z:0}, true);
            ball.body.setGravityScale(0.0, true);
        }
    }

    function onSelectEnd() {
        if (gameReady) {
            const ball = dynamicObjects.find(obj => obj.isBall);
            if (ball && ball.mesh.parent) {
                const controllerGrip = ball.mesh.parent;
                scene.add(ball.mesh);
                const worldMatrix = controllerGrip.matrixWorld;
                const throwPos = new THREE.Vector3().setFromMatrixPosition(worldMatrix);
                const throwQuat = new THREE.Quaternion().setFromRotationMatrix(worldMatrix);
                const inversePlacement = placementMatrix.clone().invert();
                throwPos.applyMatrix4(inversePlacement);
                const finalQuat = new THREE.Quaternion().multiplyQuaternions(new THREE.Quaternion().setFromRotationMatrix(inversePlacement), throwQuat);
                ball.body.setTranslation(throwPos, true);
                ball.body.setRotation(finalQuat, true);
                ball.body.setGravityScale(1.0, true);
                ball.body.wakeUp();
                const impulse = controllerVelocity.clone().multiplyScalar(4.0);
                ball.body.applyImpulse(impulse, true);
            }
        }
    }

    // --- Animation Loop ---
    function animate(timestamp, frame) {
        if (gameReady) {
            world.step();
        }

        if (renderer.xr.isPresenting) {
            if (lastTimestamp > 0) {
                const dt = (timestamp - lastTimestamp) / 1000;
                const currentPosition = new THREE.Vector3().setFromMatrixPosition(controllerGrip1.matrixWorld);
                if (dt > 0 && !lastControllerPosition.equals(new THREE.Vector3())) {
                    controllerVelocity.lerp(currentPosition.clone().sub(lastControllerPosition).divideScalar(dt), 0.1);
                }
                lastControllerPosition.copy(currentPosition);
            }
            lastTimestamp = timestamp;
        }

        laneMesh.position.setFromMatrixPosition(placementMatrix);
        laneMesh.quaternion.setFromRotationMatrix(placementMatrix);
        dynamicObjects.forEach(obj => {
            if (obj.isBall && obj.mesh.parent) return;
            const finalMatrix = new THREE.Matrix4().multiplyMatrices(placementMatrix, new THREE.Matrix4().compose(obj.body.translation(), obj.body.rotation(), {x:1,y:1,z:1}));
            obj.mesh.position.setFromMatrixPosition(finalMatrix);
            obj.mesh.quaternion.setFromRotationMatrix(finalMatrix);
        });

        renderer.render(scene, camera);
    }
    renderer.setAnimationLoop(animate);

    // --- XR Session Management ---
    renderer.xr.addEventListener('sessionstart', () => {
        // 1. Place the lane on the floor automatically
        const xrCamera = renderer.xr.getCamera();
        const userHeight = xrCamera.position.y > 0.1 ? xrCamera.position.y : 1.6;
        placementMatrix.makeTranslation(0, -userHeight, -2);

        // 2. Turn on gravity for pins now that they are placed
        dynamicObjects.forEach(obj => { if (obj.isPin) { obj.body.setGravityScale(1.0, true); } });

        // 3. Attach ball to controller
        const ball = dynamicObjects.find(obj => obj.isBall);
        if (ball) { controllerGrip1.add(ball.mesh); }

        gameReady = true;
    });

    // Controllers
    controllerGrip1 = renderer.xr.getControllerGrip(0); scene.add(controllerGrip1);
    controllerGrip2 = renderer.xr.getControllerGrip(1); scene.add(controllerGrip2);
    const controller1 = renderer.xr.getController(0); controller1.addEventListener('selectstart', onSelect); controller1.addEventListener('selectend', onSelectEnd); scene.add(controller1);
    const controller2 = renderer.xr.getController(1); controller2.addEventListener('selectstart', onSelect); controller2.addEventListener('selectend', onSelectEnd); scene.add(controller2);

    document.body.appendChild(ARButton.createButton(renderer, { requiredFeatures: ['local-floor'] }));
}

main();
