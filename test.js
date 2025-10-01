// Test environment for AR Bowling physics and game logic
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- Basic Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
camera.position.set(0, 5, 10); // A good viewpoint for testing

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 7.5);
scene.add(directionalLight);

// --- Physics Setup ---
const gravity = { x: 0.0, y: -9.81, z: 0.0 };
let world;
const loader = new GLTFLoader();

// --- Game Objects ---
let pinModel, pinVertices, pinHeight;
let laneObject, floorBody;
const dynamicObjects = [];

// This will be the core of our new collision detection system
const colliderToObjectMap = new Map();

async function initPhysics() {
    await RAPIER.init();
    world = new RAPIER.World(gravity);
    world.integrationParameters.dt = 1 / 60.0;
}

async function setupScene() {
    // Load Lane Model
    const laneGltf = await loader.loadAsync('3d/bowling.glb');
    const groundMesh = laneGltf.scene;
    scene.add(groundMesh);

    const laneBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
    const laneBody = world.createRigidBody(laneBodyDesc);

    // Create colliders for the lane and gutter
    groundMesh.traverse(child => {
        if (child.isMesh) {
            child.updateMatrixWorld(true);
            const bodyPosition = new THREE.Vector3().copy(laneBody.translation());

            if (child.name === 'lane') {
                const boundingBox = new THREE.Box3().setFromObject(child);
                const size = boundingBox.getSize(new THREE.Vector3());
                const center = boundingBox.getCenter(new THREE.Vector3());
                center.sub(bodyPosition);

                const cuboidDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
                    .setTranslation(center.x, center.y, center.z)
                    .setRestitution(0.5)
                    .setFriction(0.1);
                const collider = world.createCollider(cuboidDesc, laneBody);
                // The lane needs to be solid (for physics) AND mapped (for game logic).
                colliderToObjectMap.set(collider.handle, { type: 'lane' });

            } else if (child.name === 'gutter') {
                const transformedVertices = new Float32Array(child.geometry.attributes.position.array.length);
                child.geometry.attributes.position.array.forEach((v, i) => {
                    transformedVertices[i] = v;
                });
                const indices = child.geometry.index.array;

                const trimeshDesc = RAPIER.ColliderDesc.trimesh(transformedVertices, indices)
                    .setSensor(true);
                const collider = world.createCollider(trimeshDesc, laneBody);
                colliderToObjectMap.set(collider.handle, { type: 'gutter' });

            } else if (child.name === 'ball') {
                 child.visible = false; // We'll create our own
            } else if (child.name === 'pin') {
                pinModel = child;
                child.visible = false; // Hide template
            }
        }
    });

    // Create an infinite floor plane
    const floorBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
    floorBody = world.createRigidBody(floorBodyDesc);
    const floorColliderDesc = RAPIER.ColliderDesc.cuboid(100, 0.1, 100);
    const floorCollider = world.createCollider(floorColliderDesc, floorBody);
    colliderToObjectMap.set(floorCollider.handle, { type: 'ground' });


    // Create Bowling Ball
    const ballRadius = 0.11; // Approx radius
    const ballMesh = new THREE.Mesh(
        new THREE.SphereGeometry(ballRadius, 32, 32),
        new THREE.MeshStandardMaterial({ color: 'black' })
    );
    scene.add(ballMesh);

    const ballInitialPosition = { x: 0, y: 3, z: 2 };
    const ballBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(ballInitialPosition.x, ballInitialPosition.y, ballInitialPosition.z).setCcdEnabled(true);
    const ballBody = world.createRigidBody(ballBodyDesc);
    const ballColliderDesc = RAPIER.ColliderDesc.ball(ballRadius).setMass(5.0);
    const ballCollider = world.createCollider(ballColliderDesc, ballBody);
    const ballObject = { mesh: ballMesh, body: ballBody, type: 'ball' };
    dynamicObjects.push(ballObject);
    colliderToObjectMap.set(ballCollider.handle, ballObject);


    // Create Bowling Pins
    if (pinModel && pinModel.isMesh) {
        const correctedGeometry = pinModel.geometry.clone();
        correctedGeometry.applyMatrix4(pinModel.matrixWorld);
        correctedGeometry.computeBoundingBox();
        const trueCenter = new THREE.Vector3();
        correctedGeometry.boundingBox.getCenter(trueCenter);
        correctedGeometry.translate(-trueCenter.x, -trueCenter.y, -trueCenter.z);
        pinVertices = correctedGeometry.attributes.position.array;
        pinModel = new THREE.Mesh(correctedGeometry, pinModel.material.clone());
        pinModel.geometry.computeBoundingBox();
        pinHeight = pinModel.geometry.boundingBox.max.y - pinModel.geometry.boundingBox.min.y;
    }
    createPins(0);

    // Give the ball a push to start the simulation
    ballBody.applyImpulse({ x: 0, y: 0, z: -15 }, true);
}

function createPins(fY) {
    let pinIdCounter = 0;
    const pinSpacing = 0.2;
    const pinStartZ = -7;

    for (let row = 0; row < 4; row++) {
        for (let i = 0; i < row + 1; i++) {
            const x = (i - row / 2) * pinSpacing * 2;
            const z = pinStartZ - row * pinSpacing * 1.732;
            createPin(x, z, fY, pinIdCounter++);
        }
    }
}

function createPin(x, z, fY, id) {
    const pinMesh = pinModel.clone();
    scene.add(pinMesh);

    const initialPosition = { x: x, y: fY + (pinHeight / 2), z: z };
    const pinBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(initialPosition.x, initialPosition.y, initialPosition.z);
    const pinBody = world.createRigidBody(pinBodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.convexHull(pinVertices).setMass(1.5);
    const collider = world.createCollider(colliderDesc, pinBody);
    const pinObject = { mesh: pinMesh, body: pinBody, type: 'pin', id: id };
    dynamicObjects.push(pinObject);
    colliderToObjectMap.set(collider.handle, pinObject);
}


// --- New Core Logic Functions ---

/**
 * Checks if a rigid body is moving significantly.
 * @param {RAPIER.RigidBody} body The Rapier rigid body to check.
 * @returns {boolean} True if the body's linear or angular velocity is above a threshold.
 */
function isMoving(body) {
    const linearVelocity = body.linvel();
    const angularVelocity = body.angvel();
    const linearSpeed = Math.sqrt(linearVelocity.x**2 + linearVelocity.y**2 + linearVelocity.z**2);
    const angularSpeed = Math.sqrt(angularVelocity.x**2 + angularVelocity.y**2 + angularVelocity.z**2);

    const linearThreshold = 0.01;
    const angularThreshold = 0.1;

    return linearSpeed > linearThreshold || angularSpeed > angularThreshold;
}

/**
 * Finds all unique objects a given rigid body is in contact with.
 * @param {RAPIER.RigidBody} body The rigid body to check contacts for.
 * @returns {Array<Object>} An array of the game objects in contact with the given body.
 */
function getContactingObjects(body) {
    const contactingObjects = new Set();
    if (!world || !body) return [];
    const bodyColliderHandle = body.collider(0)?.handle;
    if (bodyColliderHandle === undefined) return [];

    world.contactPairsWith(body.collider(0), (collider1, collider2) => {
        const otherColliderHandle = collider1.handle === bodyColliderHandle ? collider2.handle : collider1.handle;
        const contactObject = colliderToObjectMap.get(otherColliderHandle);
        if (contactObject) {
            contactingObjects.add(contactObject);
        }
    });

    return Array.from(contactingObjects);
}


/**
 * Determines if a pin is fallen based on its orientation or contacts.
 * @param {Object} pinObject The pin object from our dynamicObjects array.
 * @returns {boolean} True if the pin is considered fallen.
 */
function isPinFallen(pinObject) {
    // 1. Check orientation (tilted more than 5 degrees)
    const upVector = new THREE.Vector3(0, 1, 0);
    const pinUp = upVector.clone().applyQuaternion(pinObject.mesh.quaternion);
    const angle = pinUp.angleTo(new THREE.Vector3(0, 1, 0));
    const maxAngle = THREE.MathUtils.degToRad(5); // 5 degrees

    if (angle > maxAngle) {
        return true;
    }

    // 2. Check for contact with ground or gutter
    const contacts = getContactingObjects(pinObject.body);
    for (const contact of contacts) {
        if (contact.type === 'ground' || contact.type === 'gutter') {
            return true;
        }
    }

    return false;
}


// --- Game Logic and State Management ---

const GameState = {
    READY_TO_THROW: 'READY_TO_THROW',
    BALL_IN_PLAY: 'BALL_IN_PLAY',
    AWAITING_BALL_STOP: 'AWAITING_BALL_STOP',
    PINS_SETTLING: 'PINS_SETTLING',
    SCORING: 'SCORING',
    TURN_OVER: 'TURN_OVER'
};

const gameManager = {
    state: GameState.READY_TO_THROW,
    ballHasTouchedLane: false,
    cleanupTimer: null,
    pinSettleTimer: null,

    setState(newState) {
        if (this.state !== newState) {
            console.log(`Game State changing from ${this.state} to ${newState}`);
            this.state = newState;
        }
    },

    resetForNextThrow() {
        this.ballHasTouchedLane = false;
        if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
        if (this.pinSettleTimer) clearTimeout(this.pinSettleTimer);
        this.cleanupTimer = null;
        this.pinSettleTimer = null;
        // In a full game, you'd reset the ball position here
        this.setState(GameState.READY_TO_THROW);
    }
};

function updateGameState() {
    const ball = dynamicObjects.find(o => o.type === 'ball');
    if (!ball) return;

    const ballContacts = getContactingObjects(ball.body);
    const ballIsOnLane = ballContacts.some(c => c.type === 'lane');
    const ballIsInGutterOrGround = ballContacts.some(c => c.type === 'gutter' || c.type === 'ground');
    const ballIsStopped = !isMoving(ball.body);

    switch (gameManager.state) {
        case GameState.BALL_IN_PLAY:
            if (ballIsOnLane) {
                gameManager.ballHasTouchedLane = true;
                gameManager.setState(GameState.AWAITING_BALL_STOP);
            }
            // Foul ball condition
            if (ballIsInGutterOrGround && !gameManager.ballHasTouchedLane) {
                console.log("DEAD BALL: Ball in gutter without touching lane.");
                gameManager.setState(GameState.SCORING);
            }
            break;

        case GameState.AWAITING_BALL_STOP:
            // Start cleanup timer if ball has touched lane and then stops or enters gutter
            if (gameManager.ballHasTouchedLane && (ballIsStopped || ballIsInGutterOrGround)) {
                gameManager.setState(GameState.PINS_SETTLING);
                console.log("Ball stopped or in gutter. Starting 4s cleanup timer.");

                gameManager.cleanupTimer = setTimeout(() => {
                    console.log("4s timer finished. Checking for wobbling pins.");
                    const pins = dynamicObjects.filter(o => o.type === 'pin');
                    const standingPins = pins.filter(p => !isPinFallen(p));
                    const wobblingPins = standingPins.filter(p => isMoving(p.body));

                    if (wobblingPins.length > 0) {
                        console.log(`${wobblingPins.length} pins still wobbling. Starting 2s settle timer.`);
                        gameManager.pinSettleTimer = setTimeout(() => {
                            console.log("2s pin settle timer finished. Moving to scoring.");
                            gameManager.setState(GameState.SCORING);
                        }, 2000);
                    } else {
                        console.log("Pins are settled. Moving to scoring.");
                        gameManager.setState(GameState.SCORING);
                    }
                }, 4000);
            }
            break;

        case GameState.PINS_SETTLING:
            // Logic is handled by the timers, just wait.
            break;

        case GameState.SCORING:
            console.log("--- SCORING AND CLEANUP ---");
            const allPins = dynamicObjects.filter(o => o.type === 'pin');
            const fallenPins = allPins.filter(isPinFallen);
            console.log(`Total fallen pins this turn: ${fallenPins.length}`);

            // Remove fallen pins from the simulation
            for (const pin of fallenPins) {
                // Find the corresponding entry in dynamicObjects to remove
                const index = dynamicObjects.findIndex(p => p === pin);
                if (index > -1) {
                    world.removeRigidBody(pin.body);
                    scene.remove(pin.mesh);
                    colliderToObjectMap.delete(pin.body.collider(0).handle);
                    dynamicObjects.splice(index, 1);
                }
            }

            console.log("Cleanup complete.");
            gameManager.setState(GameState.TURN_OVER);
            // In a real game, this would transition to the next roll/frame.
            // For the test, we'll just stop here.
            break;
    }
}


function animate() {
    requestAnimationFrame(animate);

    if (world) {
        // Run the game logic state machine
        if (gameManager.state !== GameState.TURN_OVER) {
            updateGameState();
        }
        world.step();
    }

    // Update visuals
    dynamicObjects.forEach(obj => {
        if (obj.body && obj.mesh) {
            const position = obj.body.translation();
            const quaternion = obj.body.rotation();
            obj.mesh.position.set(position.x, position.y, position.z);
            obj.mesh.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
        }
    });

    renderer.render(scene, camera);
}


// --- Main Execution ---
(async () => {
    await initPhysics();
    await setupScene();
    // Manually start the game after the initial throw simulation
    gameManager.setState(GameState.BALL_IN_PLAY);
    animate();
})();