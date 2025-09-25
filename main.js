const dbg = 0;

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { XRPlanes } from 'three/addons/webxr/XRPlanes.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

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

    if (renderer.xr.isPresenting) {
        const pins = dynamicObjects.filter(obj => obj.isPin);
        if (pins.length > 0) {
            let fallenPins = 0;
            for (const pin of pins) {
                const up = new THREE.Vector3(0, 1, 0);
                const quaternion = new THREE.Quaternion().copy(pin.body.rotation());
                const pinUp = up.clone().applyQuaternion(quaternion);
                if (pinUp.y < 0.5) { // Threshold for being "fallen"
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

        for (let i = 0; i < 2; i++) {
            const controller = renderer.xr.getController(i);
            if (controller && controller.gamepad) {
                // A/X button for reset
                if (controller.gamepad.buttons[4].pressed && !resetButtonState[i]) {
                    resetButtonState[i] = true;
                    resetPins();
                } else if (!controller.gamepad.buttons[4].pressed) {
                    resetButtonState[i] = false;
                }

                // B/Y button for ending session
                if (controller.gamepad.buttons[5].pressed && !endSessionButtonState[i]) {
                    endSessionButtonState[i] = true;
                    if (window.confirm("End AR session?")) {
                        renderer.xr.getSession().end();
                    }
                } else if (!controller.gamepad.buttons[5].pressed) {
                    endSessionButtonState[i] = false;
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
        let InitialPosition = { x: 0, y: fY, z: -2 };
        groundMesh.position.x = InitialPosition.x;
        groundMesh.position.y = InitialPosition.y;
        groundMesh.position.z = InitialPosition.z;

        // Create a fixed rigid body for the lane.
        const laneBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(InitialPosition.x, InitialPosition.y, InitialPosition.z);
    const laneBody = world.createRigidBody(laneBodyDesc);

    // Create a trimesh collider from the lane's geometry
    groundMesh.traverse(child => {
        if (child.isMesh) {
            const vertices = child.geometry.attributes.position.array;
            const indices = child.geometry.index.array;
            const trimeshDesc = RAPIER.ColliderDesc.trimesh(vertices, indices).setRestitution(0.0);
            world.createCollider(trimeshDesc, laneBody);
        }
    });

    scene.add(groundMesh);

    // Create Bowling Ball
    const ballGltf = await loader.loadAsync('3d/ball.glb');
    const ballMesh = ballGltf.scene;
    const ballBox = new THREE.Box3().setFromObject(ballMesh);
    const ballSize = ballBox.getSize(new THREE.Vector3());
    const ballRadius = ballSize.x / 2;

    const ballInitialPosition = { x: 0, y: fY + 0.5, z: -2 };
    const ballBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(ballInitialPosition.x, ballInitialPosition.y, ballInitialPosition.z).setCcdEnabled(true);
    const ballBody = world.createRigidBody(ballBodyDesc);
    const ballColliderDesc = RAPIER.ColliderDesc.ball(ballRadius).setRestitution(0.01).setMass(10).setFriction(.8);
    const ballCollider = world.createCollider(ballColliderDesc, ballBody);

    dynamicObjects.push({ mesh: ballMesh, body: ballBody, initialPosition: ballInitialPosition, isBall: true });
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
        const colliderDesc = RAPIER.ColliderDesc.convexHull(pinVertices);
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
                ball.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased);
                holdingController = controller;
            }
        }
    }

    function onSelectEnd(event) {
        const controller = event.target;
        if (holdingController === controller) {
            const ball = dynamicObjects.find(obj => obj.isBall);
            if (ball) {
                ball.body.setBodyType(RAPIER.RigidBodyType.Dynamic);
                const impulse = new THREE.Vector3(0, 0, -10).applyQuaternion(controller.quaternion);
                ball.body.applyImpulse(impulse, true);
            }
            holdingController = null;
        }
    }

    const controllerModelFactory = new XRControllerModelFactory();

    function setupController(controllerIndex) {
        const controller = renderer.xr.getController(controllerIndex);
        controller.userData.controllerId = controllerIndex;

        controller.addEventListener('connected', function () {
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