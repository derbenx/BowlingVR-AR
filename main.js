const dbg = 0;

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { XRPlanes } from 'three/addons/webxr/XRPlanes.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

// Collision Groups
const GROUP_LANE = 1 << 0;
const GROUP_BALL = 1 << 1;
const GROUP_PINS = 1 << 2;
const GROUP_FLOOR = 1 << 3;

// Defines what a group is and what it collides with.
// The 16 left-most bits are memberships, the 16 right-most bits are the filter.
const LANE_COLLISION_GROUP = (GROUP_LANE << 16) | (GROUP_BALL);
// Ball collides with Lane, Pins, and Floor
const BALL_COLLISION_GROUP = (GROUP_BALL << 16) | (GROUP_LANE | GROUP_PINS | GROUP_FLOOR);
// Held ball collides with Lane and Floor (so it doesn't fall through the world if dropped)
const HELD_BALL_COLLISION_GROUP = (GROUP_BALL << 16) | (GROUP_LANE | GROUP_FLOOR);
// Pins collide with Ball, other Pins, and Floor
const PINS_COLLISION_GROUP = (GROUP_PINS << 16) | (GROUP_BALL | GROUP_PINS | GROUP_FLOOR);
// Floor collides with Ball and Pins
const FLOOR_COLLISION_GROUP = (GROUP_FLOOR << 16) | (GROUP_BALL | GROUP_PINS);

const renderer = new THREE.WebGLRenderer({ antialias: true });
const scene = new THREE.Scene();
const gravity = { x: 0.0, y: -9.81 , z: 0.0 };
let world, planes;
let dynamicObjects = [];
let holdingController = null;
let placementMatrix = new THREE.Matrix4();
let camera;
let pinModel, pinVertices, fY_floor;
let resetButtonState = [false, false];
let endSessionButtonState = [false, false];
let pinsFallenResetTimer = null;
let allPinsFallen = false;
let exitConfirmationActive = false;
let exitConfirmationMesh = null;
let exitConfirmationTimer = null;
let laneObject = null;
let laneCollisionVisualizer = null;
let floorBody = null;
let controllerWantsToHold = null;

async function main() {
    await RAPIER.init();

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    world = new RAPIER.World(gravity);
    world.integrationParameters.dt = 1/120; //90fps ?

    const loader = new GLTFLoader();

    const arButton = ARButton.createButton(renderer, {
        requiredFeatures: ['local-floor', 'plane-detection']
    });
    document.body.appendChild(arButton);

    renderer.xr.addEventListener('sessionstart', () => {
        let fY = 0;
        const checkFloor = setInterval(() => {
            if (planes.children.length > 0) {
                for (const planeMesh of planes.children) {
                    fY = planeMesh.position.y < fY ? planeMesh.position.y : fY;
                }
                clearInterval(checkFloor);
                fY_floor = fY;
                placeScene(fY, loader, world, dynamicObjects);
            }
        }, 150);
    });

    renderer.xr.addEventListener('sessionend', cleanupScene);

    // Setup plane detection
    planes = new XRPlanes(renderer);
    //scene.add(planes);

    if (navigator.xr && navigator.xr.isSessionSupported) {
        navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
          if (supported && navigator.xr.requestSession) {
            navigator.xr.requestSession('immersive-vr', {
              optionalFeatures: ['local-floor','plane-detection'],
            })
            .then((session) => {renderer.xr.setSession(session);});
          }
        });
      }

    init();
}

function animate(timestamp, frame) {
    // Step the physics world first
    if(world) world.step();

    // If a grab was initiated in the last frame, complete it now.
    // This one-frame delay ensures the collision group change is processed before the ball is moved.
    if (controllerWantsToHold) {
        const ball = dynamicObjects.find(obj => obj.isBall);
        if (ball) {
            ball.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased);
            holdingController = controllerWantsToHold;
        }
        controllerWantsToHold = null;
    }

    // Update all dynamic objects
    if (holdingController) {
        const ball = dynamicObjects.find(obj => obj.isBall);
        if (ball) {
            const controllerGrip = renderer.xr.getControllerGrip(holdingController.userData.controllerId);
            ball.body.setNextKinematicTranslation(controllerGrip.position);
            ball.body.setNextKinematicRotation(controllerGrip.quaternion);
        }
    }

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

    if (exitConfirmationMesh) {
        const cameraPosition = new THREE.Vector3();
        const cameraQuaternion = new THREE.Quaternion();
        camera.getWorldPosition(cameraPosition);
        camera.getWorldQuaternion(cameraQuaternion);

        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraQuaternion);
        exitConfirmationMesh.position.copy(cameraPosition).add(forward.multiplyScalar(2)); // Place 2 units in front
        exitConfirmationMesh.quaternion.copy(cameraQuaternion);
    }

    if (renderer.xr.isPresenting) {
        const pins = dynamicObjects.filter(obj => obj.isPin);
        if (pins.length > 0) {
            let fallenPins = 0;
            for (const pin of pins) {
                // Check orientation
                const up = new THREE.Vector3(0, 1, 0);
                const quaternion = new THREE.Quaternion().copy(pin.body.rotation());
                const pinUp = up.clone().applyQuaternion(quaternion);
                const isTippedOver = pinUp.y < 0.5;

                // Check distance from start
                const currentPosition = new THREE.Vector3().copy(pin.body.translation());
                const initialPositionVec = new THREE.Vector3(pin.initialPosition.x, pin.initialPosition.y, pin.initialPosition.z);
                const distance = currentPosition.distanceTo(initialPositionVec);
                const isFarAway = distance > 1.0; // 1 meter threshold

                if (isTippedOver || isFarAway) {
                    fallenPins++;
                }
            }

            if (fallenPins === pins.length && !allPinsFallen) {
                allPinsFallen = true;
                pinsFallenResetTimer = setTimeout(() => {
                    resetPins();
                    pinsFallenResetTimer = null;
                }, 4000);
            }
        }

        const dt = world.integrationParameters.dt;
        for (let i = 0; i < 2; i++) {
            const controller = renderer.xr.getController(i);

            // Calculate linear velocity
            const currentPosition = controller.position.clone();
            controller.userData.linearVelocity = currentPosition.clone().sub(controller.userData.lastPosition).divideScalar(dt);
            controller.userData.lastPosition.copy(currentPosition);

            // Calculate angular velocity
            const currentQuaternion = controller.quaternion.clone();
            const deltaQuaternion = currentQuaternion.clone().multiply(controller.userData.lastQuaternion.clone().invert());

            let angle = 2 * Math.acos(deltaQuaternion.w);
            if (angle > Math.PI) {
                angle -= 2 * Math.PI;
            }
            const axis = new THREE.Vector3(deltaQuaternion.x, deltaQuaternion.y, deltaQuaternion.z);
            if (axis.lengthSq() > 0) {
                axis.normalize();
            }
            controller.userData.angularVelocity = axis.multiplyScalar(angle / dt);
            controller.userData.lastQuaternion.copy(currentQuaternion);

            if (controller && controller.gamepad) {

                // Handle B/Y button (index 5) for exiting
                if (controller.gamepad.buttons[5].pressed && !endSessionButtonState[i]) {
                    endSessionButtonState[i] = true; // Mark as pressed
                    if (exitConfirmationActive) {
                        // Second press: dismiss the UI first, then end the session
                        dismissExitConfirmation();
                        renderer.xr.getSession().end();
                    } else {
                        // First press: show confirmation
                        exitConfirmationActive = true;
                        exitConfirmationMesh = createExitConfirmationMesh();
                        scene.add(exitConfirmationMesh);

                        // Auto-dismiss after 5 seconds
                        exitConfirmationTimer = setTimeout(dismissExitConfirmation, 5000);
                    }
                } else if (!controller.gamepad.buttons[5].pressed) {
                    endSessionButtonState[i] = false; // Mark as released
                }

                // Handle A/X button (index 4) for resetting pins or dismissing confirmation
                if (controller.gamepad.buttons[4].pressed && !resetButtonState[i]) {
                    resetButtonState[i] = true; // Mark as pressed
                    if (exitConfirmationActive) {
                        dismissExitConfirmation();
                    } else {
                        resetPins();
                    }
                } else if (!controller.gamepad.buttons[4].pressed) {
                    resetButtonState[i] = false; // Mark as released
                }

                // Also dismiss on trigger press (index 0)
                if (exitConfirmationActive && controller.gamepad.buttons[0].pressed) {
                    dismissExitConfirmation();
                }
            }
        }
    }
}

async function placeScene(fY, loader, world, dynamicObjects) {
    // Load Lane Model
    const laneGltf = await loader.loadAsync('3d/lane.glb');

        // Visual ground and Physics Ground
        const groundMesh = laneGltf.scene;

        // Create a fixed rigid body for the lane at the origin.
        // We will set its final position after creating all components.
        const laneBodyDesc = RAPIER.RigidBodyDesc.fixed();
        const laneBody = world.createRigidBody(laneBodyDesc);
        laneObject = { mesh: groundMesh, body: laneBody };

    // Create a trimesh collider that is correctly scaled to the visual model
    groundMesh.traverse(child => {
        if (child.isMesh) {
            child.updateMatrixWorld(true); // Ensure world matrix is up-to-date
            const originalVertices = child.geometry.attributes.position.array;
            const transformedVertices = new Float32Array(originalVertices.length);
            const tempVec = new THREE.Vector3();
            // The body is at the origin, so its position is (0,0,0).
            // This means the transformed vertices will be in the body's local space, which is what we want.
            const bodyPosition = new THREE.Vector3(laneBody.translation().x, laneBody.translation().y, laneBody.translation().z);

            for (let i = 0; i < originalVertices.length; i += 3) {
                tempVec.set(originalVertices[i], originalVertices[i+1], originalVertices[i+2]);
                // 1. Transform vertex to world space using the mesh's world matrix
                tempVec.applyMatrix4(child.matrixWorld);
                // 2. Transform vertex from world space to the rigid body's local space
                tempVec.sub(bodyPosition);

                transformedVertices[i] = tempVec.x;
                transformedVertices[i+1] = tempVec.y;
                transformedVertices[i+2] = tempVec.z;
            }

            const indices = child.geometry.index.array;
            const trimeshDesc = RAPIER.ColliderDesc.trimesh(transformedVertices, indices).setRestitution(0.0).setCollisionGroups(LANE_COLLISION_GROUP);
            world.createCollider(trimeshDesc, laneBody);

            // Create and add the visualizer mesh
            const visualizerGeo = new THREE.BufferGeometry();
            visualizerGeo.setAttribute('position', new THREE.BufferAttribute(transformedVertices, 3));
            visualizerGeo.setIndex(new THREE.BufferAttribute(indices, 1));
            const visualizerMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 });
            laneCollisionVisualizer = new THREE.Mesh(visualizerGeo, visualizerMat);
            // Position it at the rigid body's location (which is currently the origin)
            laneCollisionVisualizer.position.copy(bodyPosition);
            scene.add(laneCollisionVisualizer);
        }
    });

    scene.add(groundMesh);

    // Set the initial position for all lane components using the new function
    const initialPosition = new THREE.Vector3(0, fY, -2);
    setLanePosition(initialPosition);

    // Create an infinite floor plane to prevent objects from falling through
    const floorBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, fY_floor, 0);
    floorBody = world.createRigidBody(floorBodyDesc);
    const floorColliderDesc = RAPIER.ColliderDesc.halfspace(0, 1, 0)
        .setCollisionGroups(FLOOR_COLLISION_GROUP)
        .setRestitution(0.2);
    world.createCollider(floorColliderDesc, floorBody);

    // Create Bowling Ball
    const ballGltf = await loader.loadAsync('3d/ball.glb');
    const ballMesh = ballGltf.scene;
    const ballBox = new THREE.Box3().setFromObject(ballMesh);

    // Center the geometry
    const center = ballBox.getCenter(new THREE.Vector3());
    ballMesh.children.forEach(child => {
        if (child.isMesh) {
            child.geometry.translate(-center.x, -center.y, -center.z);
        }
    });
    ballBox.setFromObject(ballMesh); // Recalculate the box after centering

    const ballSize = ballBox.getSize(new THREE.Vector3());
    const ballRadius = ballSize.x / 2;

    const ballInitialPosition = { x: 0, y: fY + 0.5, z: -2 };
    const ballBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(ballInitialPosition.x, ballInitialPosition.y, ballInitialPosition.z).setCcdEnabled(true);
    const ballBody = world.createRigidBody(ballBodyDesc);
    const ballColliderDesc = RAPIER.ColliderDesc.ball(ballRadius).setRestitution(0.01).setMass(100).setFriction(.8).setCollisionGroups(BALL_COLLISION_GROUP);
    const ballCollider = world.createCollider(ballColliderDesc, ballBody);

    dynamicObjects.push({ mesh: ballMesh, body: ballBody, collider: ballCollider, initialPosition: ballInitialPosition, isBall: true });
    scene.add(ballMesh);
    ballMesh.visible = true;

    // Create Bowling Pins
    const pinGltf = await loader.loadAsync('3d/pin.glb');
    pinModel = pinGltf.scene;
    
    pinModel.traverse(child => {
        if (child.isMesh) {
            child.updateMatrixWorld(true);
            const originalVertices = child.geometry.attributes.position.array;
            const transformedVertices = new Float32Array(originalVertices.length);
            const tempVec = new THREE.Vector3();
            for (let i = 0; i < originalVertices.length; i += 3) {
                tempVec.set(originalVertices[i], originalVertices[i+1], originalVertices[i+2]);
                tempVec.applyMatrix4(child.matrixWorld);
                transformedVertices[i] = tempVec.x;
                transformedVertices[i+1] = tempVec.y;
                transformedVertices[i+2] = tempVec.z;
            }
            pinVertices = transformedVertices;
        }
    });

    createPins(fY);
}

function createPins(fY) {
    function createPin(x, z) {
        const pinMesh = pinModel.clone();
        const initialPosition = { x: x, y: fY, z: z };
        const pinBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(initialPosition.x, initialPosition.y, initialPosition.z);
        const pinBody = world.createRigidBody(pinBodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.convexHull(pinVertices).setCollisionGroups(PINS_COLLISION_GROUP);
        const collider = world.createCollider(colliderDesc, pinBody);
        dynamicObjects.push({ mesh: pinMesh, body: pinBody, initialPosition: initialPosition, isPin: true });
        scene.add(pinMesh);
        pinMesh.visible = true;
    }

    const pinSpacing = 0.2;
    const pinStartZ = -5; //where pins are located!
    
    for (let row = 0; row < 4; row++) {
        for (let i = 0; i < row + 1; i++) {
            const x = (i - row / 2) * pinSpacing * 2;
            const z = pinStartZ - row * pinSpacing * 1.732;
            createPin(x, z);
        }
    }
}

function resetPins() {
    dismissExitConfirmation();
    if (pinsFallenResetTimer) {
        clearTimeout(pinsFallenResetTimer);
        pinsFallenResetTimer = null;
    }
    allPinsFallen = false;

    // Remove existing pins
    const pinsToRemove = dynamicObjects.filter(obj => obj.isPin);
    for (const pin of pinsToRemove) {
        scene.remove(pin.mesh);
        world.removeRigidBody(pin.body);
    }

    // Filter out the pins from dynamicObjects
    dynamicObjects = dynamicObjects.filter(obj => !obj.isPin);

    // Create new pins
    createPins(fY_floor);
}

function dismissExitConfirmation() {
    if (exitConfirmationMesh) {
        scene.remove(exitConfirmationMesh);
        exitConfirmationMesh = null;
    }
    exitConfirmationActive = false;
    if (exitConfirmationTimer) {
        clearTimeout(exitConfirmationTimer);
        exitConfirmationTimer = null;
    }
}

function createExitConfirmationMesh() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext('2d');

    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = 'white';
    context.font = '30px sans-serif';
    context.textAlign = 'center';
    context.fillText('Press B/Y again to exit', canvas.width / 2, canvas.height / 2 - 20);
    context.fillText('Any other key to close this.', canvas.width / 2, canvas.height / 2 + 20);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const geometry = new THREE.PlaneGeometry(1, 0.5);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    const mesh = new THREE.Mesh(geometry, material);

    return mesh;
}

function setLanePosition(position) {
    if (laneObject) {
        // Move the visual mesh
        laneObject.mesh.position.copy(position);

        // Move the physics rigid body
        laneObject.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    }

    if (laneCollisionVisualizer) {
        // Move the collision visualizer to match the new body position
        laneCollisionVisualizer.position.copy(position);
    }
}

function cleanupScene() {
    // Dismiss any active UI
    dismissExitConfirmation();

    // Clear any pending timers
    if (pinsFallenResetTimer) {
        clearTimeout(pinsFallenResetTimer);
    }

    // Remove all dynamic objects (pins and ball)
    for (const obj of dynamicObjects) {
        scene.remove(obj.mesh);
        world.removeRigidBody(obj.body);
    }
    dynamicObjects = [];

    // Remove the lane
    if (laneObject) {
        scene.remove(laneObject.mesh);
        world.removeRigidBody(laneObject.body);
        laneObject = null;
    }
    if (laneCollisionVisualizer) {
        scene.remove(laneCollisionVisualizer);
        laneCollisionVisualizer = null;
    }
    if (floorBody) {
        world.removeRigidBody(floorBody);
        floorBody = null;
    }

    // Reset state variables
    holdingController = null;
    allPinsFallen = false;
    resetButtonState = [false, false];
    endSessionButtonState = [false, false];
}

async function init() {
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 2, 5); // Move camera up and back
    camera.lookAt(0, 0, 0);

    const ambientLight = new THREE.AmbientLight(0x404040, 2); // soft white light
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    placementMatrix = new THREE.Matrix4();
    
    renderer.setAnimationLoop(animate);

    function onSelectStart(event) {
        const controller = event.target;
        if (holdingController === null) {
            const ball = dynamicObjects.find(obj => obj.isBall);
            if (ball) {
                // Set the collision group immediately to prevent collision on the next physics step.
                ball.collider.setCollisionGroups(HELD_BALL_COLLISION_GROUP);
                // Register the intent to hold, which will be processed in the animate loop after the next physics step.
                controllerWantsToHold = controller;
            }
        }
    }

    function onSelectEnd(event) {
        const controller = event.target;
        if (holdingController === controller) {
            const ball = dynamicObjects.find(obj => obj.isBall);
            if (ball) {
                ball.collider.setCollisionGroups(BALL_COLLISION_GROUP); // Re-enable collision with pins
                ball.body.setBodyType(RAPIER.RigidBodyType.Dynamic);

                // Apply the controller's velocity to the ball
                const throwVelocityMultiplier = 2.0;
                const linearVelocity = controller.userData.linearVelocity.clone().multiplyScalar(throwVelocityMultiplier);
                const angularVelocity = controller.userData.angularVelocity.clone().multiplyScalar(throwVelocityMultiplier);

                ball.body.setLinvel(linearVelocity, true);
                ball.body.setAngvel(angularVelocity, true);
            }
            holdingController = null;
        }
    }

    const controllerModelFactory = new XRControllerModelFactory();

    function setupController(controllerIndex) {
        const controller = renderer.xr.getController(controllerIndex);
        controller.userData.controllerId = controllerIndex;
        controller.userData.lastPosition = new THREE.Vector3();
        controller.userData.lastQuaternion = new THREE.Quaternion();
        controller.userData.linearVelocity = new THREE.Vector3();
        controller.userData.angularVelocity = new THREE.Vector3();


        controller.addEventListener('connected', function (event) {
            this.gamepad = event.data.gamepad;
            this.addEventListener('selectstart', onSelectStart);
            this.addEventListener('selectend', onSelectEnd);
        });

        controller.addEventListener('disconnected', function () {
            this.removeEventListener('selectstart', onSelectStart);
            this.removeEventListener('selectend', onSelectEnd);
        });

        scene.add(controller);

        const controllerGrip = renderer.xr.getControllerGrip(controllerIndex);
        controllerGrip.add(controllerModelFactory.createControllerModel(controllerGrip));
        scene.add(controllerGrip);
    }

    setupController(0);
    setupController(1);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

main();