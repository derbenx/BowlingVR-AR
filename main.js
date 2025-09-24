import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';

let camera, scene, renderer;
let controller;
let assetsLoaded = false;
let lowestPlaneY = null;

let world, groundCollider;
const rigidBodies = [];

init();

async function init() {
    const container = document.createElement('div');
    document.body.appendChild(container);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 3);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    document.body.appendChild(ARButton.createButton(renderer, { requiredFeatures: ['plane-detection'] }));

    // Physics
    await RAPIER.init();
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    world = new RAPIER.World(gravity);

    controller = renderer.xr.getController(0);
    scene.add(controller);

    window.addEventListener('resize', onWindowResize);

    animate();
}

async function loadAssets(floorY) {
    assetsLoaded = true;
    const loader = new GLTFLoader();
    const [laneGltf, pinGltf, ballGltf] = await Promise.all([
        loader.loadAsync('3d/lane.glb'),
        loader.loadAsync('3d/pin.glb'),
        loader.loadAsync('3d/ball.glb')
    ]);

    // Setup Lane on the detected floor
    const lane = laneGltf.scene;
    lane.position.set(0, floorY, -5); // Place it on the floor, 5m in front
    scene.add(lane);

    const laneMesh = lane.children[0];
    if (laneMesh && laneMesh.geometry) {
        const vertices = laneMesh.geometry.attributes.position.array;
        let indices;

        if (!laneMesh.geometry.index) {
            indices = new Uint32Array(vertices.length / 3);
            for (let i = 0; i < indices.length; i++) {
                indices[i] = i;
            }
        } else {
            indices = laneMesh.geometry.index.array;
        }

        const laneShape = RAPIER.ColliderDesc.trimesh(vertices, indices);
        const laneBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(lane.position.x, lane.position.y, lane.position.z);
        const laneBody = world.createRigidBody(laneBodyDesc);
        world.createCollider(laneShape, laneBody);
    } else {
        console.error("Lane model does not contain a valid mesh.");
    }

    // Setup Pins
    const pinPositions = [
        { x: 0, z: -5 },
        { x: -0.3, z: -5.5 }, { x: 0.3, z: -5.5 },
        { x: -0.6, z: -6 }, { x: 0, z: -6 }, { x: 0.6, z: -6 },
        { x: -0.9, z: -6.5 }, { x: -0.3, z: -6.5 }, { x: 0.3, z: -6.5 }, { x: 0.9, z: -6.5 }
    ];

    for (let i = 0; i < 10; i++) {
        const pin = pinGltf.scene.clone();
        const pinPos = new THREE.Vector3(pinPositions[i].x, 0.2, pinPositions[i].z);
        pinPos.add(lane.position);
        pin.position.copy(pinPos);
        scene.add(pin);

        const pinShape = RAPIER.ColliderDesc.convexHull(pin.children[0].geometry.attributes.position.array);
        const pinBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(pin.position.x, pin.position.y, pin.position.z);
        const pinBody = world.createRigidBody(pinBodyDesc);
        world.createCollider(pinShape, pinBody);
        rigidBodies.push({ mesh: pin, body: pinBody });
    }

    // Setup Ball
    const ball = ballGltf.scene;
    const ballPos = new THREE.Vector3(0, 0.2, 2);
    ballPos.add(lane.position);
    ball.position.copy(ballPos);
    scene.add(ball);

    const ballShape = RAPIER.ColliderDesc.ball(0.1);
    const ballBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(ball.position.x, ball.position.y, ball.position.z);
    const ballBody = world.createRigidBody(ballBodyDesc);
    world.createCollider(ballShape, ballBody);
    rigidBodies.push({ mesh: ball, body: ballBody });

    controller.addEventListener('selectstart', () => {
        controller.userData.startPosition = controller.position.clone();
    });

    controller.addEventListener('selectend', () => {
        const startPosition = controller.userData.startPosition;
        const endPosition = controller.position;
        const velocity = new THREE.Vector3().subVectors(endPosition, startPosition).multiplyScalar(-5);
        ballBody.applyImpulse({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
    if (frame && !assetsLoaded) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (session.detectedPlanes) {
            let foundFloor = false;
            session.detectedPlanes.forEach(plane => {
                if (plane.orientation === 'horizontal') {
                    const pose = frame.getPose(plane.planeSpace, referenceSpace);
                    if (pose) {
                        if (lowestPlaneY === null || pose.transform.position.y < lowestPlaneY) {
                            lowestPlaneY = pose.transform.position.y;
                        }
                        foundFloor = true;
                    }
                }
            });

            if (foundFloor) {
                loadAssets(lowestPlaneY);
            }
        }
    }

    // Step the physics world
    if (world) world.step();

    // Update the positions of the rigid bodies
    for(const obj of rigidBodies){
        obj.mesh.position.copy(obj.body.translation());
        obj.mesh.quaternion.copy(obj.body.rotation());
    }

    renderer.render(scene, camera);
}
