import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

async function main() {
    await RAPIER.init();

    // 1. Scene Setup
    const scene = new THREE.Scene();
//scene.background = new THREE.Color(0xaaaaaa); // Use a light gray background

    // Physics World
    const gravity = { x: 0.0, y: -.5 , z: 0.0 };
    //const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    const world = new RAPIER.World(gravity);

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 5); // Move camera up and back
camera.lookAt(0, 0, 0);

// 3. Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

// 4. Lighting
const ambientLight = new THREE.AmbientLight(0x404040, 2); // soft white light
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 5, 5);
scene.add(directionalLight);

    // 5. Create Game Elements
    const loader = new GLTFLoader();


    // Load Lane Model
    const laneGltf = await loader.loadAsync('3d/lane.glb');
   

    // Visual ground and Physics Ground
    const groundMesh = laneGltf.scene;

    // Create a trimesh collider from the lane's geometry
    groundMesh.traverse(child => {
        if (child.isMesh) {
            const vertices = child.geometry.attributes.position.array.slice(); // Important: slice to create a copy
            const indices = child.geometry.index.array;
            const trimeshDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
            world.createCollider(trimeshDesc);
        }
    });

    scene.add(groundMesh);
    groundMesh.visible = true; //show in 2d
    

    // Array to hold dynamic objects
    let dynamicObjects = [];

    // Create Bowling Ball
    const ballGltf = await loader.loadAsync('3d/ball.glb');
    const ballMesh = ballGltf.scene;
    const ballBox = new THREE.Box3().setFromObject(ballMesh);
    const ballSize = ballBox.getSize(new THREE.Vector3());
    const ballRadius = ballSize.x / 2;

    const ballInitialPosition = { x: 0, y: 0.5 , z: 8  };
    const ballBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(ballInitialPosition.x, ballInitialPosition.y, ballInitialPosition.z);
    const ballBody = world.createRigidBody(ballBodyDesc);
    const ballColliderDesc = RAPIER.ColliderDesc.ball(ballRadius);
    world.createCollider(ballColliderDesc, ballBody);

    dynamicObjects.push({ mesh: ballMesh, body: ballBody, initialPosition: ballInitialPosition, isBall: true });
    scene.add(ballMesh);
    ballMesh.visible = true;

    // Create Bowling Pins
    const pinGltf = await loader.loadAsync('3d/pin.glb');
    const pinModel = pinGltf.scene;
    
    const pinBox = new THREE.Box3().setFromObject(pinModel);
    const pinSize = pinBox.getSize(new THREE.Vector3());
    const pinHeight = pinSize.y;
    const pinRadius = Math.max(pinSize.x, pinSize.z) / 2;

    function createPin(x, z) {
        const pinMesh = pinModel.clone();

        const capsuleHeight = pinHeight * 0.8; // Use 80% of model height for the physics capsule
        const colliderCenterY = (capsuleHeight / 2) + (pinHeight * 0.1); // Center the capsule and lift it slightly

        // The initial position for both the mesh and the body is the center of the physics shape.
        const initialPosition = { x: x, y: 4, z: z };

        const pinBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(initialPosition.x, initialPosition.y, initialPosition.z);
        const pinBody = world.createRigidBody(pinBodyDesc);

        // The capsule is now centered on the rigid body, so its local translation is 0.
        const capsule = RAPIER.ColliderDesc.capsule(capsuleHeight / 2, pinRadius);
        world.createCollider(capsule, pinBody);

        dynamicObjects.push({ mesh: pinMesh, body: pinBody, initialPosition: initialPosition });
        scene.add(pinMesh);
        pinMesh.visible = true;
    }

    // Layout pins in a triangle
    const pinSpacing = 0.2 ;
    const pinStartZ = -3.5 ;
    let pinCount = 0;
    for (let row = 0; row < 4; row++) {
        for (let i = 0; i < row + 1; i++) {
            const x = (i - row / 2) * pinSpacing * 2;
            const z = pinStartZ - row * pinSpacing * 1.732; // 1.732 is ~sqrt(3) for equilateral triangle
            createPin(x, z);
            pinCount++;
        }
    }


    let placementMatrix = new THREE.Matrix4();
    let isScenePlaced = false;

    // 6. Animation Loop
    function animate(timestamp, frame) {
        // Step the physics world first
        world.step();

        // Update all dynamic objects
        dynamicObjects.forEach(obj => {
            const body = obj.body;
            const mesh = obj.mesh;

            const position = new THREE.Vector3().copy(body.translation());
            const quaternion = new THREE.Quaternion().copy(body.rotation());

            const physicsMatrix = new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1));
            const finalMatrix = new THREE.Matrix4().multiplyMatrices(placementMatrix, physicsMatrix);

            mesh.position.setFromMatrixPosition(finalMatrix);
            mesh.quaternion.setFromRotationMatrix(finalMatrix);
        });


        renderer.render(scene, camera);
    }

    

    renderer.xr.addEventListener('sessionstart', () => {
        if (isScenePlaced) return; // Prevent re-placing if session restarts

        isScenePlaced = true;
        groundMesh.visible = true;
        dynamicObjects.forEach(obj => {
            obj.mesh.visible = true;
        });

        // Get user's head height and offset the scene to the floor
        const xrCamera = renderer.xr.getCamera();
        const userHeight = xrCamera.position.y > 0.1 ? xrCamera.position.y : 1.6; // Default to 1.6m if height is 0

        //placementMatrix.makeTranslation(0, -userHeight, -2); // Place 2m in front, adjusted for user height
        //Floor doesn't move
        //groundMesh.position.setFromMatrixPosition(placementMatrix);
        //groundMesh.quaternion.setFromRotationMatrix(placementMatrix);
        

    });


// 7. Handle Window Resizing
    window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

    // Start the animation
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
