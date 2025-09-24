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
    camera.position.set(0, 2, 5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0x404040, 2);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    const globalScale = 1.0 / 1.9;
    const loader = new GLTFLoader();

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
    groundMesh.traverse(child => {
        if (child.isMesh) {
            const vertices = child.geometry.attributes.position.array.slice();
            const indices = child.geometry.index.array;
            for (let i = 0; i < vertices.length; i++) { vertices[i] *= globalScale; }
            const trimeshDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
            world.createCollider(trimeshDesc);
        }
    });

    let dynamicObjects = [];

    // Setup Ball
    const ballMesh = ballGltf.scene;
    ballMesh.scale.setScalar(globalScale);
    const ballBox = new THREE.Box3().setFromObject(ballMesh);
    const ballRadius = ballBox.getSize(new THREE.Vector3()).x / 2;
    const ballInitialPosition = { x: 0, y: 0.5 * globalScale, z: 8 * globalScale };
    const ballBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(ballInitialPosition.x, ballInitialPosition.y, ballInitialPosition.z);
    const ballBody = world.createRigidBody(ballBodyDesc);
    const ballColliderDesc = RAPIER.ColliderDesc.ball(ballRadius);
    world.createCollider(ballColliderDesc, ballBody);
    dynamicObjects.push({ mesh: ballMesh, body: ballBody, initialPosition: ballInitialPosition, isBall: true });
    scene.add(ballMesh);

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
        dynamicObjects.push({ mesh: pinMesh, body: pinBody, initialPosition: initialPosition });
        scene.add(pinMesh);
    }

    const pinSpacing = 0.2 * globalScale;
    const pinStartZ = -5 * globalScale;
    for (let row = 0; row < 4; row++) {
        for (let i = 0; i < row + 1; i++) {
            createPin((i - row / 2) * pinSpacing * 2, pinStartZ - row * pinSpacing * 1.732);
        }
    }

    let placementMatrix = new THREE.Matrix4();

    function animate(timestamp, frame) {
        world.step();
        dynamicObjects.forEach(obj => {
            const finalMatrix = new THREE.Matrix4().multiplyMatrices(placementMatrix, new THREE.Matrix4().compose(obj.body.translation(), obj.body.rotation(), {x:1,y:1,z:1}));
            obj.mesh.position.setFromMatrixPosition(finalMatrix);
            obj.mesh.quaternion.setFromRotationMatrix(finalMatrix);
        });
        laneMesh.position.setFromMatrixPosition(placementMatrix);
        laneMesh.quaternion.setFromRotationMatrix(placementMatrix);
        renderer.render(scene, camera);
    }

    renderer.xr.addEventListener('sessionstart', () => {
        scene.traverse(child => { if(child.isMesh) child.visible = true; });
        const xrCamera = renderer.xr.getCamera();
        const userHeight = xrCamera.position.y > 0.1 ? xrCamera.position.y : 1.6;
        placementMatrix.makeTranslation(0, -userHeight, -2);
    });

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    renderer.setAnimationLoop(animate);

    function onSelect() {
        const ball = dynamicObjects.find(obj => obj.isBall);
        if (ball) {
            const isIdle = Math.abs(ball.body.linvel().z) < 0.1 && Math.abs(ball.body.linvel().x) < 0.1;
            if (isIdle) {
                const placementQuaternion = new THREE.Quaternion().setFromRotationMatrix(placementMatrix);
                const impulse = new THREE.Vector3(0, 0, -0.4).applyQuaternion(placementQuaternion);
                ball.body.applyImpulse(impulse, true);
            }
        }
    }

    const controller1 = renderer.xr.getController(0);
    controller1.addEventListener('select', onSelect);
    scene.add(controller1);
    const controller2 = renderer.xr.getController(1);
    controller2.addEventListener('select', onSelect);
    scene.add(controller2);

    document.body.appendChild(ARButton.createButton(renderer, { requiredFeatures: ['local-floor'] }));
}

main();
