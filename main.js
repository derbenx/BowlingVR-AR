import * as THREE from 'three';
import { ARButton } from 'three/addons/controllers/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';

let camera, scene, renderer;
let controller;
let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;

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

    document.body.appendChild(ARButton.createButton(renderer, { requiredFeatures: ['hit-test'] }));

    // Physics
    await RAPIER.init();
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    world = new RAPIER.World(gravity);

    // Reticle
    reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial()
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);
    scene.add(controller);

    window.addEventListener('resize', onWindowResize);

    animate();
}

let assetsLoaded = false;
function onSelect() {
    if (reticle.visible && !assetsLoaded) {
        const loader = new GLTFLoader();
        Promise.all([
            loader.loadAsync('3d/lane.glb'),
            loader.loadAsync('3d/pin.glb'),
            loader.loadAsync('3d/ball.glb')
        ]).then(([laneGltf, pinGltf, ballGltf]) => {
            // Setup Lane
            const lane = laneGltf.scene;
            lane.position.setFromMatrixPosition(reticle.matrix);
            scene.add(lane);

            if (lane.children[0].geometry.index) {
                const laneShape = RAPIER.ColliderDesc.trimesh(
                    lane.children[0].geometry.attributes.position.array,
                    lane.children[0].geometry.attributes.index.array
                );
                const laneBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(lane.position.x, lane.position.y, lane.position.z);
                const laneBody = world.createRigidBody(laneBodyDesc);
                world.createCollider(laneShape, laneBody);
            } else {
                console.error("Lane model has no indexed geometry. Cannot create trimesh collider.");
            }


            // Setup Pins
            const pinPositions = [
                // Front pin
                { x: 0, z: -5 },
                // Second row
                { x: -0.3, z: -5.5 }, { x: 0.3, z: -5.5 },
                // Third row
                { x: -0.6, z: -6 }, { x: 0, z: -6 }, { x: 0.6, z: -6 },
                // Fourth row
                { x: -0.9, z: -6.5 }, { x: -0.3, z: -6.5 }, { x: 0.3, z: -6.5 }, { x: 0.9, z: -6.5 }
            ];

            for (let i = 0; i < 10; i++) {
                const pin = pinGltf.scene.clone();
                const pinPos = new THREE.Vector3(pinPositions[i].x, 0.2, pinPositions[i].z);
                pinPos.add(lane.position); // Position relative to lane
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
            assetsLoaded = true;
            reticle.visible = false;
        });
    }
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
    if (frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (hitTestSourceRequested === false) {
            session.requestReferenceSpace('viewer').then(function (referenceSpace) {
                session.requestHitTestSource({ space: referenceSpace }).then(function (source) {
                    hitTestSource = source;
                });
            });

            session.addEventListener('end', function () {
                hitTestSourceRequested = false;
                hitTestSource = null;
            });

            hitTestSourceRequested = true;
        }

        if (hitTestSource) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);
            if (hitTestResults.length) {
                const hit = hitTestResults[0];
                reticle.visible = true;
                reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
            } else {
                reticle.visible = false;
            }
        }
    }

    // Step the physics world
    world.step();

    // Update the positions of the rigid bodies
    for(const obj of rigidBodies){
        obj.mesh.position.copy(obj.body.translation());
        obj.mesh.quaternion.copy(obj.body.rotation());
    }

    renderer.render(scene, camera);
}
