const dbg = 0;

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { XRPlanes } from 'three/addons/webxr/XRPlanes.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

// --- Global State Variables ---

const renderer = new THREE.WebGLRenderer({ antialias: true });
const scene = new THREE.Scene();
const gravity = { x: 0.0, y: -9.81 , z: 0.0 };
let world, planes;
let dynamicObjects = [];
let holdingController = null;
let placementMatrix = new THREE.Matrix4();
let camera;
let pinModel, pinVertices, fY_floor;

// Collision Groups
const GROUP_LANE = 1 << 0;
const GROUP_BALL = 1 << 1;
const GROUP_PINS = 1 << 2;
const GROUP_FLOOR = 1 << 3;
const LANE_COLLISION_GROUP = (GROUP_LANE << 16) | (GROUP_BALL | GROUP_PINS);
const BALL_COLLISION_GROUP = (GROUP_BALL << 16) | (GROUP_LANE | GROUP_PINS | GROUP_FLOOR);
const HELD_BALL_COLLISION_GROUP = (GROUP_BALL << 16) | (GROUP_LANE | GROUP_FLOOR);
const PINS_COLLISION_GROUP = (GROUP_PINS << 16) | (GROUP_BALL | GROUP_PINS | GROUP_LANE);
const FLOOR_COLLISION_GROUP = (GROUP_FLOOR << 16) | (GROUP_BALL);

// Floor Adjustment State
let floorOffset = parseFloat(localStorage.getItem('floorOffset')) || 0;
let gripButtonState = [false, false];
let floorOffsetSaveTimer = null;

// Controller and UI Interaction State
let resetButtonState = [false, false];
let endSessionButtonState = [false, false];
let triggerState = [false, false];
let thumbstickXState = [0, 0];
let thumbstickYState = [0, 0];
let menuButtonState = false;
let hudButtonState = false;

// UI and Game Logic State
let gameMode = localStorage.getItem('gameMode') || 'practice';
let activeUI = 'none';
let optionsMenu = null;
let selectedMenuIndex = 0;
let resetConfirmationDialog = null;
let resetDialogSelectionIndex = 0;
let pinHUD = null;
let scoreboard = null;
let scoreData = [];
let currentFrame = 0;
let currentRoll = 0;
let isGameOver = false;
let exitConfirmationMesh = null;
let exitConfirmationActive = false;
let exitConfirmationTimer = null;
let pinsFallenResetTimer = null;
let allPinsFallen = false;
let laneObject = null;
let floorBody = null;
let controllerWantsToHold = null;
let debugDisplay = null;

// --- UI Creation Functions ---

function updateButtonAppearance(button, hovered) {
    if (!button) return;
    const context = button.userData.context;
    const canvas = button.userData.canvas;
    const text = button.userData.mode === 'practice' ? 'Practice' : 'Scoring';

    context.fillStyle = hovered ? '#666' : '#444';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = hovered ? '#FFF' : '#888';
    context.lineWidth = 10;
    context.strokeRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = 'white';
    context.font = 'bold 40px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    button.material.map.needsUpdate = true;
}

function createOptionsMenu() {
    const menu = new THREE.Group();
    menu.name = "optionsMenu";
    menu.userData.buttons = [];

    const panelGeo = new THREE.PlaneGeometry(0.6, 0.5);
    const panelMat = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.9 });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    menu.add(panel);

    function createButton(text, yPos, mode) {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const context = canvas.getContext('2d');
        const texture = new THREE.CanvasTexture(canvas);
        const geometry = new THREE.PlaneGeometry(0.5, 0.15);
        const material = new THREE.MeshBasicMaterial({ map: texture });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = yPos;
        mesh.position.z = 0.01;
        mesh.name = `button_${mode}`;
        mesh.userData = { mode, isButton: true, canvas, context };
        updateButtonAppearance(mesh, false);
        return mesh;
    }

    const practiceButton = createButton('Practice', 0.1, 'practice');
    const scoringButton = createButton('Scoring', -0.1, 'scoring');
    menu.add(practiceButton, scoringButton);
    menu.userData.buttons.push(practiceButton, scoringButton);
    menu.visible = false;
    scene.add(menu);
    return menu;
}

function createScoreboard() {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(3.5, 0.42);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    const boardMesh = new THREE.Mesh(geometry, material);
    boardMesh.name = "scoreboard";
    boardMesh.userData = { canvas, context };
    boardMesh.visible = false;
    scene.add(boardMesh);
    return boardMesh;
}

function drawScoreboard() {
    if (!scoreboard) return;
    const ctx = scoreboard.userData.context;
    const canvas = scoreboard.userData.canvas;
    ctx.fillStyle = '#000033';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const frameWidth = (canvas.width - 40) / 11;
    const frameHeight = canvas.height - 40;
    const startX = 20;
    const startY = 20;
    const smallBoxSize = frameWidth / 3.5;
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.fillStyle = 'white';
    let cumulativeTotal = 0;
    for (let i = 0; i < 11; i++) {
        const x = startX + i * frameWidth;
        if (i < 10) {
            ctx.strokeRect(x, startY, frameWidth, frameHeight);
            ctx.beginPath();
            ctx.moveTo(x, startY + smallBoxSize);
            ctx.lineTo(x + frameWidth, startY + smallBoxSize);
            ctx.stroke();
            const frameScore = scoreData[i].frameScore || '';
            cumulativeTotal += parseInt(frameScore) || 0;
            ctx.font = '60px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(frameScore, x + frameWidth / 2, startY + smallBoxSize + (frameHeight - smallBoxSize) / 2);
            ctx.font = '30px sans-serif';
            if (i < 9) {
                ctx.strokeRect(x + frameWidth - 2 * smallBoxSize, startY, smallBoxSize, smallBoxSize);
                ctx.strokeRect(x + frameWidth - smallBoxSize, startY, smallBoxSize, smallBoxSize);
                ctx.fillText(scoreData[i].rolls[0], x + frameWidth - (1.5 * smallBoxSize), startY + smallBoxSize / 2);
                ctx.fillText(scoreData[i].rolls[1], x + frameWidth - (0.5 * smallBoxSize), startY + smallBoxSize / 2);
            } else {
                ctx.strokeRect(x + frameWidth - 3 * smallBoxSize, startY, smallBoxSize, smallBoxSize);
                ctx.strokeRect(x + frameWidth - 2 * smallBoxSize, startY, smallBoxSize, smallBoxSize);
                ctx.strokeRect(x + frameWidth - smallBoxSize, startY, smallBoxSize, smallBoxSize);
                ctx.fillText(scoreData[i].rolls[0], x + frameWidth - (2.5 * smallBoxSize), startY + smallBoxSize / 2);
                ctx.fillText(scoreData[i].rolls[1], x + frameWidth - (1.5 * smallBoxSize), startY + smallBoxSize / 2);
                ctx.fillText(scoreData[i].rolls[2], x + frameWidth - (0.5 * smallBoxSize), startY + smallBoxSize / 2);
            }
        } else {
            ctx.strokeRect(x, startY, frameWidth, frameHeight);
            ctx.font = '60px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(cumulativeTotal.toString(), x + frameWidth / 2, startY + frameHeight / 2);
        }
    }
    scoreboard.material.map.needsUpdate = true;
}

function createPinHUD() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(0.4, 0.4);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    const hudMesh = new THREE.Mesh(geometry, material);
    hudMesh.name = "pinHUD";
    hudMesh.userData = { canvas, context };
    hudMesh.visible = false;
    scene.add(hudMesh);
    return hudMesh;
}

function drawPinHUD() {
    if (!pinHUD) return;
    const ctx = pinHUD.userData.context;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const pinLayout = [
        { x: 128, y: 200 }, { x: 108, y: 170 }, { x: 148, y: 170 },
        { x: 88, y: 140 }, { x: 128, y: 140 }, { x: 168, y: 140 },
        { x: 68, y: 110 }, { x: 108, y: 110 }, { x: 148, y: 110 }, { x: 188, y: 110 },
    ];
    ctx.beginPath();
    ctx.moveTo(pinLayout[0].x, pinLayout[0].y + 20);
    ctx.lineTo(pinLayout[6].x - 20, pinLayout[6].y - 20);
    ctx.lineTo(pinLayout[9].x + 20, pinLayout[9].y - 20);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    const allPins = dynamicObjects.filter(obj => obj.isPin);
    pinLayout.forEach((pos, index) => {
        const pin = allPins.find(p => p.pinIndex === index);
        let isStanding = pin ? (new THREE.Vector3(0, 1, 0).applyQuaternion(pin.mesh.quaternion).y >= 0.5) : false;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 12, 0, 2 * Math.PI);
        ctx.fillStyle = isStanding ? 'rgba(255, 255, 255, 0.8)' : 'rgba(85, 85, 85, 0.5)';
        ctx.fill();
    });
    pinHUD.material.map.needsUpdate = true;
}

function updateResetButtonAppearance(button, hovered) {
    if (!button) return;
    const context = button.userData.context;
    const canvas = button.userData.canvas;
    const text = button.userData.label;
    context.fillStyle = hovered ? '#880000' : '#550000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = hovered ? '#FFF' : '#888';
    context.lineWidth = 10;
    context.strokeRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'white';
    context.font = 'bold 40px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    button.material.map.needsUpdate = true;
}

function createResetConfirmationDialog() {
    const dialog = new THREE.Group();
    dialog.name = "resetConfirmationDialog";
    dialog.userData.buttons = [];
    const panelGeo = new THREE.PlaneGeometry(0.8, 0.5);
    const panelMat = new THREE.MeshBasicMaterial({ color: 0x111122, transparent: true, opacity: 0.95 });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    dialog.add(panel);
    const qCanvas = document.createElement('canvas');
    qCanvas.width = 1024;
    qCanvas.height = 128;
    const qContext = qCanvas.getContext('2d');
    qContext.fillStyle = 'white';
    qContext.font = 'bold 48px sans-serif';
    qContext.textAlign = 'center';
    qContext.textBaseline = 'middle';
    qContext.fillText('Clear the current game?', qCanvas.width / 2, qCanvas.height / 2);
    const qTexture = new THREE.CanvasTexture(qCanvas);
    const qGeo = new THREE.PlaneGeometry(0.7, 0.1);
    const qMat = new THREE.MeshBasicMaterial({ map: qTexture, transparent: true });
    const qMesh = new THREE.Mesh(qGeo, qMat);
    qMesh.position.set(0, 0.15, 0.01);
    dialog.add(qMesh);
    function createButton(text, xPos, choice) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const context = canvas.getContext('2d');
        const texture = new THREE.CanvasTexture(canvas);
        const geometry = new THREE.PlaneGeometry(0.25, 0.15);
        const material = new THREE.MeshBasicMaterial({ map: texture });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(xPos, -0.1, 0.01);
        mesh.userData = { choice, label: text, canvas, context };
        updateResetButtonAppearance(mesh, false);
        return mesh;
    }
    const noButton = createButton('NO', -0.2, 'no');
    const yesButton = createButton('YES', 0.2, 'yes');
    dialog.add(noButton, yesButton);
    dialog.userData.buttons.push(noButton, yesButton);
    dialog.visible = false;
    scene.add(dialog);
    return dialog;
}

// --- Game Logic Functions ---

function resetScoreboard() {
    scoreData = [
        { rolls: ['7', '2'], frameScore: '9' }, { rolls: ['9', '/'], frameScore: '20' },
        { rolls: ['X', ''], frameScore: '19' }, { rolls: ['8', '1'], frameScore: '9' },
        { rolls: ['X', ''], frameScore: '20' }, { rolls: ['X', ''], frameScore: '20' },
        { rolls: ['X', ''], frameScore: '29' }, { rolls: ['9', '0'], frameScore: '9' },
        { rolls: ['8', '/'], frameScore: '20' }, { rolls: ['X', 'X', 'X'], frameScore: '30' }
    ];
    currentFrame = 0;
    currentRoll = 0;
    isGameOver = false;
    drawScoreboard();
}

function updateGameModeUI() {
    if (gameMode === 'scoring') {
        if (scoreboard) {
            if (laneObject) {
                const lanePosition = laneObject.mesh.position;
                scoreboard.position.set(lanePosition.x, lanePosition.y + 1.5, lanePosition.z - 2);
            }
            scoreboard.visible = true;
            resetScoreboard();
        }
    } else {
        if (scoreboard) scoreboard.visible = false;
    }
}

function getBallLocationState() {
    if (holdingController) return 'in-hand';
    const ball = dynamicObjects.find(obj => obj.isBall);
    if (!ball) return 'noball';
    const position = ball.body.translation();
    const adjustedFloorY = fY_floor + floorOffset;
    if (position.y < adjustedFloorY + 0.1 && position.y > adjustedFloorY) return 'gutter';
    if (position.y < adjustedFloorY) return 'ground';
    return 'lane';
}

function updateFloorAndLanePosition(yDelta = 0) {
    if (laneObject) {
        const newPos = laneObject.mesh.position.clone();
        newPos.y = fY_floor + floorOffset;
        setLanePosition(newPos);
    }
    if (floorBody) {
        const floorPosition = floorBody.translation();
        floorBody.setTranslation({ x: floorPosition.x, y: (fY_floor - 0.25) + floorOffset, z: floorPosition.z }, true);
    }
    const pins = dynamicObjects.filter(obj => obj.isPin);
    pins.forEach(pin => {
        if (pin.body.bodyType() === RAPIER.RigidBodyType.KinematicPositionBased) {
            const currentPos = pin.body.translation();
            pin.body.setNextKinematicTranslation({ x: currentPos.x, y: currentPos.y + yDelta, z: currentPos.z });
        }
    });
}

function dismissExitConfirmation() {
    if (exitConfirmationMesh) {
        scene.remove(exitConfirmationMesh);
        exitConfirmationMesh = null;
    }
    exitConfirmationActive = false;
    activeUI = 'none';
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
    context.fillText('Press B/Y again to exit.', canvas.width / 2, canvas.height / 2 - 20);
    context.fillText('Any other key to close this.', canvas.width / 2, canvas.height / 2 + 20);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const geometry = new THREE.PlaneGeometry(1, 0.5);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    return new THREE.Mesh(geometry, material);
}

function setLanePosition(position) {
    if (laneObject) {
        laneObject.mesh.position.copy(position);
        laneObject.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    }
}

function cleanupScene() {
    dismissExitConfirmation();
    if (optionsMenu) optionsMenu.visible = false;
    if (resetConfirmationDialog) resetConfirmationDialog.visible = false;
    if (pinHUD) pinHUD.visible = false;
    activeUI = 'none';
    if (pinsFallenResetTimer) clearTimeout(pinsFallenResetTimer);
    dynamicObjects.forEach(obj => {
        scene.remove(obj.mesh);
        world.removeRigidBody(obj.body);
    });
    dynamicObjects = [];
    if (laneObject) {
        scene.remove(laneObject.mesh);
        world.removeRigidBody(laneObject.body);
        laneObject = null;
    }
    if (floorBody) {
        world.removeRigidBody(floorBody);
        floorBody = null;
    }
    holdingController = null;
    allPinsFallen = false;
    resetButtonState = [false, false];
    endSessionButtonState = [false, false];
}

function createPins(fY) {
    function createPin(x, z, index) {
        const pinMesh = pinModel.clone();
        const initialPosition = { x: x, y: fY, z: z };
        const pinBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(initialPosition.x, initialPosition.y, initialPosition.z);
        const pinBody = world.createRigidBody(pinBodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.convexHull(pinVertices).setCollisionGroups(PINS_COLLISION_GROUP);
        const collider = world.createCollider(colliderDesc, pinBody);
        dynamicObjects.push({ mesh: pinMesh, body: pinBody, initialPosition: initialPosition, isPin: true, pinIndex: index });
        scene.add(pinMesh);
    }
    let pinIndex = 0;
    for (let row = 0; row < 4; row++) {
        for (let i = 0; i < row + 1; i++) {
            const x = (i - row / 2) * 0.2 * 2;
            const z = -7 - row * 0.2 * 1.732;
            createPin(x, z, pinIndex++);
        }
    }
}

function getFallenPins() {
    return dynamicObjects.filter(obj => {
        if (!obj.isPin) return false;
        const up = new THREE.Vector3(0, 1, 0);
        const pinUp = up.clone().applyQuaternion(obj.mesh.quaternion);
        return pinUp.y < 0.5;
    });
}

function resetPins() {
    if (pinsFallenResetTimer) clearTimeout(pinsFallenResetTimer);
    allPinsFallen = false;
    const pinsToRemove = dynamicObjects.filter(obj => obj.isPin);
    pinsToRemove.forEach(pin => {
        scene.remove(pin.mesh);
        world.removeRigidBody(pin.body);
    });
    dynamicObjects = dynamicObjects.filter(obj => !obj.isPin);
    createPins(fY_floor + floorOffset);
}

// --- Main Application ---

async function main() {
    await RAPIER.init();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);
    world = new RAPIER.World(gravity);
    world.integrationParameters.dt = 1 / 120;
    const loader = new GLTFLoader();
    const arButton = ARButton.createButton(renderer, { requiredFeatures: ['local-floor', 'plane-detection'] });
    document.body.appendChild(arButton);
    renderer.xr.addEventListener('sessionstart', () => {
        let fY = 0;
        planes = new XRPlanes(renderer);
        const checkFloor = setInterval(() => {
            if (planes.children.length > 0) {
                for (const planeMesh of planes.children) fY = Math.min(fY, planeMesh.position.y);
                clearInterval(checkFloor);
                fY_floor = fY;
                placeScene(fY, loader, world, dynamicObjects);
                updateGameModeUI();
            }
        }, 150);
    });
    renderer.xr.addEventListener('sessionend', cleanupScene);
    init();
}

function animate(timestamp, frame) {
    if (world) world.step();

    if (controllerWantsToHold) {
        const ball = dynamicObjects.find(obj => obj.isBall);
        if (ball) {
            ball.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased);
            holdingController = controllerWantsToHold;
        }
        controllerWantsToHold = null;
    }

    if (holdingController) {
        const controllerGrip = renderer.xr.getControllerGrip(holdingController.userData.controllerId);
        const ball = dynamicObjects.find(obj => obj.isBall);
        if(ball) {
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

    if (pinHUD && pinHUD.visible) drawPinHUD();
    renderer.render(scene, camera);

    if (renderer.xr.isPresenting) {
        if (dynamicObjects.filter(obj => obj.isPin).length > 0 && getFallenPins().length === dynamicObjects.filter(obj => obj.isPin).length && !allPinsFallen) {
            allPinsFallen = true;
            pinsFallenResetTimer = setTimeout(() => {
                resetPins();
                pinsFallenResetTimer = null;
            }, 4000);
        }

        const dt = world.integrationParameters.dt;
        for (let i = 0; i < 2; i++) {
            const controller = renderer.xr.getController(i);
            if (!controller || !controller.gamepad) continue;

            const currentPosition = controller.position.clone();
            controller.userData.linearVelocity = currentPosition.clone().sub(controller.userData.lastPosition).divideScalar(dt);
            controller.userData.lastPosition.copy(currentPosition);
            const currentQuaternion = controller.quaternion.clone();
            const deltaQuaternion = currentQuaternion.clone().multiply(controller.userData.lastQuaternion.clone().invert());
            let angle = 2 * Math.acos(deltaQuaternion.w);
            if (angle > Math.PI) angle -= 2 * Math.PI;
            const axis = new THREE.Vector3(deltaQuaternion.x, deltaQuaternion.y, deltaQuaternion.z);
            if (axis.lengthSq() > 0) axis.normalize();
            controller.userData.angularVelocity = axis.multiplyScalar(angle / dt);
            controller.userData.lastQuaternion.copy(currentQuaternion);

            // --- Game and UI Interaction Logic ---

            // Floor adjustment can happen anytime no UI is active
            if (activeUI === 'none') {
                const ballLocation = getBallLocationState();
                const canAdjust = ballLocation !== 'lane';
                if (controller.gamepad.buttons[1].pressed && canAdjust) {
                    if (!gripButtonState[i]) {
                        gripButtonState[i] = true;
                        dynamicObjects.filter(obj => obj.isPin).forEach(pin => pin.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased));
                    }
                    const thumbstickY = controller.gamepad.axes[3];
                    if (Math.abs(thumbstickY) > 0.1) {
                        const yDelta = thumbstickY * -0.01;
                        floorOffset += yDelta;
                        updateFloorAndLanePosition(yDelta);
                        if (floorOffsetSaveTimer) clearTimeout(floorOffsetSaveTimer);
                        floorOffsetSaveTimer = setTimeout(() => localStorage.setItem('floorOffset', floorOffset), 120000);
                    }
                } else if (gripButtonState[i]) {
                    gripButtonState[i] = false;
                    dynamicObjects.filter(obj => obj.isPin).forEach(pin => pin.body.setBodyType(RAPIER.RigidBodyType.Dynamic));
                }
            }

            // Handle B/Y button (index 5) for exiting or cancelling
            if (controller.gamepad.buttons[5].pressed && !endSessionButtonState[i]) {
                endSessionButtonState[i] = true;
                if (activeUI === 'exitConfirm') {
                    dismissExitConfirmation();
                    renderer.xr.getSession().end();
                } else if (activeUI !== 'none') {
                    if(optionsMenu) optionsMenu.visible = false;
                    if(resetConfirmationDialog) resetConfirmationDialog.visible = false;
                    activeUI = 'none';
                } else {
                    activeUI = 'exitConfirm';
                    exitConfirmationMesh = createExitConfirmationMesh();
                    const camPos = new THREE.Vector3();
                    camera.getWorldPosition(camPos);
                    const camQuat = new THREE.Quaternion();
                    camera.getWorldQuaternion(camQuat);
                    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
                    exitConfirmationMesh.position.copy(camPos).add(forward.multiplyScalar(2));
                    exitConfirmationMesh.quaternion.copy(camQuat);
                    scene.add(exitConfirmationMesh);
                    exitConfirmationTimer = setTimeout(dismissExitConfirmation, 5000);
                }
            } else if (!controller.gamepad.buttons[5].pressed) {
                endSessionButtonState[i] = false;
            }

            // Handle A/X button (index 4) for resetting pins or dismissing confirmation
            if (controller.gamepad.buttons[4].pressed && !resetButtonState[i]) {
                resetButtonState[i] = true;
                if (activeUI === 'exitConfirm') dismissExitConfirmation();
                else if (gameMode === 'scoring' && activeUI === 'none') {
                    activeUI = 'resetDialog';
                    resetConfirmationDialog.visible = true;
                    const camPos = new THREE.Vector3();
                    camera.getWorldPosition(camPos);
                    const camQuat = new THREE.Quaternion();
                    camera.getWorldQuaternion(camQuat);
                    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
                    resetConfirmationDialog.position.copy(camPos).add(forward.multiplyScalar(1.5));
                    resetConfirmationDialog.quaternion.copy(camQuat);
                    updateResetButtonAppearance(resetConfirmationDialog.userData.buttons[0], true);
                    updateResetButtonAppearance(resetConfirmationDialog.userData.buttons[1], false);
                } else if (gameMode === 'practice' && activeUI === 'none') {
                    resetPins();
                }
            } else if (!controller.gamepad.buttons[4].pressed) {
                resetButtonState[i] = false;
            }

            // Handle Options Menu Toggle (left controller, options button 12)
            if (i === 0 && controller.gamepad.buttons[12] && controller.gamepad.buttons[12].pressed && !menuButtonState) {
                menuButtonState = true;
                if (activeUI === 'optionsMenu') {
                    const selectedButton = optionsMenu.userData.buttons[selectedMenuIndex];
                    if (selectedButton) {
                        gameMode = selectedButton.userData.mode;
                        localStorage.setItem('gameMode', gameMode);
                        updateGameModeUI();
                    }
                    optionsMenu.visible = false;
                    activeUI = 'none';
                } else if (activeUI === 'none') {
                    activeUI = 'optionsMenu';
                    optionsMenu.visible = true;
                    const camPos = new THREE.Vector3();
                    camera.getWorldPosition(camPos);
                    const camQuat = new THREE.Quaternion();
                    camera.getWorldQuaternion(camQuat);
                    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
                    optionsMenu.position.copy(camPos).add(forward.multiplyScalar(1.5));
                    optionsMenu.quaternion.copy(camQuat);
                    updateButtonAppearance(optionsMenu.userData.buttons[selectedMenuIndex], true);
                }
            } else if (i === 0 && controller.gamepad.buttons[12] && !controller.gamepad.buttons[12].pressed) {
                menuButtonState = false;
            }

            // Handle Pin HUD Toggle (left controller, thumbstick press 3)
            if (i === 0 && controller.gamepad.buttons[3] && controller.gamepad.buttons[3].pressed && !hudButtonState) {
                hudButtonState = true;
                if (pinHUD) {
                    pinHUD.visible = !pinHUD.visible;
                    if (pinHUD.visible && laneObject) {
                        const lanePosition = laneObject.mesh.position;
                        pinHUD.position.set(lanePosition.x, lanePosition.y + 2.0, lanePosition.z - 2);
                        if (scoreboard) pinHUD.quaternion.copy(scoreboard.quaternion);
                    }
                }
            } else if (i === 0 && controller.gamepad.buttons[3] && !controller.gamepad.buttons[3].pressed) {
                hudButtonState = false;
            }

            // Handle Interaction with Active UI
            if (activeUI === 'optionsMenu') {
                const thumbstickY = controller.gamepad.axes[3];
                const buttons = optionsMenu.userData.buttons;
                if (thumbstickY < -0.5 && thumbstickYState[i] !== -1) {
                    thumbstickYState[i] = -1;
                    const oldIndex = selectedMenuIndex;
                    selectedMenuIndex = Math.max(0, selectedMenuIndex - 1);
                    if (oldIndex !== selectedMenuIndex) {
                        updateButtonAppearance(buttons[oldIndex], false);
                        updateButtonAppearance(buttons[selectedMenuIndex], true);
                    }
                } else if (thumbstickY > 0.5 && thumbstickYState[i] !== 1) {
                    thumbstickYState[i] = 1;
                    const oldIndex = selectedMenuIndex;
                    selectedMenuIndex = Math.min(buttons.length - 1, selectedMenuIndex + 1);
                    if (oldIndex !== selectedMenuIndex) {
                        updateButtonAppearance(buttons[oldIndex], false);
                        updateButtonAppearance(buttons[selectedMenuIndex], true);
                    }
                } else if (Math.abs(thumbstickY) < 0.2) {
                    thumbstickYState[i] = 0;
                }
                if (controller.gamepad.buttons[0].pressed && !triggerState[i]) {
                    triggerState[i] = true;
                    const selectedButton = buttons[selectedMenuIndex];
                    if (selectedButton) {
                        gameMode = selectedButton.userData.mode;
                        localStorage.setItem('gameMode', gameMode);
                        optionsMenu.visible = false;
                        activeUI = 'none';
                        updateGameModeUI();
                    }
                } else if (!controller.gamepad.buttons[0].pressed) {
                    triggerState[i] = false;
                }
            } else if (activeUI === 'resetDialog') {
                const thumbstickX = controller.gamepad.axes[2];
                const buttons = resetConfirmationDialog.userData.buttons;
                if (thumbstickX < -0.5 && thumbstickXState[i] !== -1) {
                    thumbstickXState[i] = -1;
                    if (resetDialogSelectionIndex === 1) {
                        resetDialogSelectionIndex = 0;
                        updateResetButtonAppearance(buttons[1], false);
                        updateResetButtonAppearance(buttons[0], true);
                    }
                } else if (thumbstickX > 0.5 && thumbstickXState[i] !== 1) {
                    thumbstickXState[i] = 1;
                    if (resetDialogSelectionIndex === 0) {
                        resetDialogSelectionIndex = 1;
                        updateResetButtonAppearance(buttons[0], false);
                        updateResetButtonAppearance(buttons[1], true);
                    }
                } else if (Math.abs(thumbstickX) < 0.2) {
                    thumbstickXState[i] = 0;
                }
                const axPressed = controller.gamepad.buttons[4].pressed;
                const triggerPressed = controller.gamepad.buttons[0].pressed;
                if ((axPressed && !resetButtonState[i]) || (triggerPressed && !triggerState[i])) {
                    if (resetDialogSelectionIndex === 1) {
                        resetPins();
                        resetScoreboard();
                    }
                    resetConfirmationDialog.visible = false;
                    activeUI = 'none';
                    resetDialogSelectionIndex = 0;
                    updateResetButtonAppearance(buttons[0], false);
                    updateResetButtonAppearance(buttons[1], false);
                    if (axPressed) resetButtonState[i] = true;
                    if (triggerPressed) triggerState[i] = true;
                }
            }
        }
    }
}

async function placeScene(fY, loader, world, dynamicObjects) {
    const laneGltf = await loader.loadAsync('3d/lane.glb');
    const groundMesh = laneGltf.scene;
    const laneBodyDesc = RAPIER.RigidBodyDesc.fixed();
    const laneBody = world.createRigidBody(laneBodyDesc);
    laneObject = { mesh: groundMesh, body: laneBody };
    groundMesh.traverse(child => {
        if (child.isMesh) {
            child.updateMatrixWorld(true);
            const originalVertices = child.geometry.attributes.position.array;
            const transformedVertices = new Float32Array(originalVertices.length);
            const tempVec = new THREE.Vector3();
            const bodyPosition = new THREE.Vector3(laneBody.translation().x, laneBody.translation().y, laneBody.translation().z);
            for (let i = 0; i < originalVertices.length; i += 3) {
                tempVec.set(originalVertices[i], originalVertices[i+1], originalVertices[i+2]);
                tempVec.applyMatrix4(child.matrixWorld);
                tempVec.sub(bodyPosition);
                transformedVertices[i] = tempVec.x;
                transformedVertices[i+1] = tempVec.y;
                transformedVertices[i+2] = tempVec.z;
            }
            const indices = child.geometry.index.array;
            const trimeshDesc = RAPIER.ColliderDesc.trimesh(transformedVertices, indices).setRestitution(0.0).setCollisionGroups(LANE_COLLISION_GROUP);
            world.createCollider(trimeshDesc, laneBody);
        }
    });
    scene.add(groundMesh);
    const initialPosition = new THREE.Vector3(0, fY, -2);
    setLanePosition(initialPosition);
    const floorBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, fY_floor - 0.25, 0);
    floorBody = world.createRigidBody(floorBodyDesc);
    const floorColliderDesc = RAPIER.ColliderDesc.cuboid(100, 0.1, 100).setCollisionGroups(FLOOR_COLLISION_GROUP).setRestitution(0.2);
    world.createCollider(floorColliderDesc, floorBody);
    updateFloorAndLanePosition();
    const ballGltf = await loader.loadAsync('3d/ball.glb');
    const ballMesh = ballGltf.scene;
    const ballBox = new THREE.Box3().setFromObject(ballMesh);
    const center = ballBox.getCenter(new THREE.Vector3());
    ballMesh.children.forEach(child => {
        if (child.isMesh) child.geometry.translate(-center.x, -center.y, -center.z);
    });
    ballBox.setFromObject(ballMesh);
    const ballSize = ballBox.getSize(new THREE.Vector3());
    const ballRadius = ballSize.x / 2;
    const ballInitialPosition = { x: 0, y: fY + 0.5, z: -2 };
    const ballBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(ballInitialPosition.x, ballInitialPosition.y, ballInitialPosition.z).setCcdEnabled(true);
    const ballBody = world.createRigidBody(ballBodyDesc);
    const ballColliderDesc = RAPIER.ColliderDesc.ball(ballRadius).setRestitution(0.01).setMass(9999).setFriction(.8).setCollisionGroups(BALL_COLLISION_GROUP);
    const ballCollider = world.createCollider(ballColliderDesc, ballBody);
    dynamicObjects.push({ mesh: ballMesh, body: ballBody, collider: ballCollider, initialPosition: ballInitialPosition, isBall: true });
    scene.add(ballMesh);
    const pinGltf = await loader.loadAsync('3d/pin.glb');
    pinModel = pinGltf.scene;
    pinModel.traverse(child => {
        if (child.isMesh) {
            child.updateMatrixWorld(true);
            const originalVertices = child.geometry.attributes.position.array;
            pinVertices = new Float32Array(originalVertices.length);
            const tempVec = new THREE.Vector3();
            for (let i = 0; i < originalVertices.length; i += 3) {
                tempVec.set(originalVertices[i], originalVertices[i+1], originalVertices[i+2]);
                tempVec.applyMatrix4(child.matrixWorld);
                pinVertices[i] = tempVec.x;
                pinVertices[i+1] = tempVec.y;
                pinVertices[i+2] = tempVec.z;
            }
        }
    });
    createPins(fY);
}

async function init() {
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 0);
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);
    placementMatrix = new THREE.Matrix4();
    optionsMenu = createOptionsMenu();
    scoreboard = createScoreboard();
    pinHUD = createPinHUD();
    resetConfirmationDialog = createResetConfirmationDialog();
    renderer.setAnimationLoop(animate);
    function onSelectStart(event) {
        const controller = event.target;
        if (!holdingController) {
            const ball = dynamicObjects.find(obj => obj.isBall);
            if (ball) {
                const isMoving = new THREE.Vector3().copy(ball.body.linvel()).length() > 0.1;
                const ballLocation = getBallLocationState();
                if (!isMoving || ballLocation === 'gutter' || ballLocation === 'ground') {
                    if (ballLocation !== 'in-hand') {
                        const fallenPins = getFallenPins();
                        dynamicObjects.filter(obj => obj.isPin && fallenPins.includes(obj)).forEach(pin => {
                            scene.remove(pin.mesh);
                            world.removeRigidBody(pin.body);
                        });
                        dynamicObjects = dynamicObjects.filter(obj => !getFallenPins().includes(obj));
                    }
                    ball.collider.setCollisionGroups(HELD_BALL_COLLISION_GROUP);
                    controllerWantsToHold = controller;
                }
            }
        }
    }
    function onSelectEnd(event) {
        const controller = event.target;
        if (holdingController === controller) {
            const ball = dynamicObjects.find(obj => obj.isBall);
            if (ball) {
                ball.collider.setCollisionGroups(BALL_COLLISION_GROUP);
                ball.body.setBodyType(RAPIER.RigidBodyType.Dynamic);
                const throwVelocityMultiplier = 1.1;
                const linearVelocity = controller.userData.linearVelocity.clone().multiplyScalar(throwVelocityMultiplier);
                const angularVelocity = controller.userData.angularVelocity.clone();
                ball.body.setLinvel(linearVelocity, true);
                ball.body.setAngvel(angularVelocity, true);
            }
            holdingController = null;
        }
    }
    const controllerModelFactory = new XRControllerModelFactory();
    for (let i = 0; i < 2; i++) {
        const controller = renderer.xr.getController(i);
        controller.userData.controllerId = i;
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
        const controllerGrip = renderer.xr.getControllerGrip(i);
        controllerGrip.add(controllerModelFactory.createControllerModel(controllerGrip));
        scene.add(controllerGrip);
    }
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

main();