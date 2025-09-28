// BUTTONS [ trigger:0, grip:1, stick: 3, A/X: 4, B/Y: 5, options: 12 ]
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
const LANE_COLLISION_GROUP = (GROUP_LANE << 16) | (GROUP_BALL | GROUP_PINS);
// Ball collides with Lane, Pins, and Floor
const BALL_COLLISION_GROUP = (GROUP_BALL << 16) | (GROUP_LANE | GROUP_PINS | GROUP_FLOOR);
// Held ball collides with Lane and Floor
const HELD_BALL_COLLISION_GROUP = (GROUP_BALL << 16) | (GROUP_LANE | GROUP_FLOOR);
// Pins collide with the Ball, other Pins, and the Lane (but NOT the infinite floor)
const PINS_COLLISION_GROUP = (GROUP_PINS << 16) | (GROUP_BALL | GROUP_PINS | GROUP_LANE);
// Floor collides with the Ball ONLY
const FLOOR_COLLISION_GROUP = (GROUP_FLOOR << 16) | (GROUP_BALL);

const renderer = new THREE.WebGLRenderer({ antialias: true });
const scene = new THREE.Scene();
const gravity = { x: 0.0, y: -9.81 , z: 0.0 };
let world, planes;
let dynamicObjects = [];
let holdingController = null;
let placementMatrix = new THREE.Matrix4();
let camera;
let pinModel, pinVertices, fY_floor;
let floorOffset = parseFloat(localStorage.getItem('floorOffset')) || 0;
let resetButtonState = [false, false];
let endSessionButtonState = [false, false];
let gripButtonState = [false, false];
let triggerState = [false, false];
let gameMode = localStorage.getItem('gameMode') || 'freeplay';
let pinsFallenResetTimer = null;
let allPinsFallen = false;
let activeConfirmationDialog = null;
let floorOffsetSaveTimer = null;
let optionsMenu = null;
let menuButtonState = false;
let hudButtonState = false;
let selectedMenuIndex = 0;
let thumbstickYState = [0, 0]; // 0: neutral, 1: up, -1: down
let thumbstickXState = [0, 0]; // 0: neutral, 1: right, -1: left
let scoreboard = null;
let scoreData = [];
let currentFrame = 0;
let currentRoll = 0;
let isGameOver = false;
let isBallThrown = false;
let pinsDownLastRoll = 0;
let pinHUD = null;
let debugDisplay = null;
let laneObject = null;
let floorBody = null;
let controllerWantsToHold = null;
let showCollision=0;//debug stuff
let showButtons = 0;
let laneCollisionVisualizer = null;

function createOptionsMenu() {
    const menu = new THREE.Group();
    menu.name = "optionsMenu";
    menu.userData.buttons = [];

    const panelGeo = new THREE.PlaneGeometry(0.6, 0.5);
    const panelMat = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.9 });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    menu.add(panel);

    const updateButtonAppearance = (button, selected) => {
        const context = button.userData.context;
        const canvas = button.userData.canvas;
        const text = button.userData.mode === 'freeplay' ? 'Free Play' : 'Scoring';
        context.fillStyle = '#444';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = selected ? '#0F0' : '#888'; // Green for selected, grey for default
        context.lineWidth = 10;
        context.strokeRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = 'white';
        context.font = 'bold 40px sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, canvas.width / 2, canvas.height / 2);
        button.material.map.needsUpdate = true;
    };

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
        mesh.userData.mode = mode;
        mesh.userData.isButton = true;
        mesh.userData.canvas = canvas;
        mesh.userData.context = context;
        updateButtonAppearance(mesh, false);
        return mesh;
    }

    const freePlayButton = createButton('Free Play', 0.1, 'freeplay');
    const scoringButton = createButton('Scoring', -0.1, 'scoring');
    menu.add(freePlayButton);
    menu.add(scoringButton);
    menu.userData.buttons.push(freePlayButton);
    menu.userData.buttons.push(scoringButton);

    menu.userData.update = () => {
        menu.userData.buttons.forEach((btn, index) => {
            updateButtonAppearance(btn, index === selectedMenuIndex);
        });
    };

    menu.visible = false;
    scene.add(menu);
    return menu;
}

function updateGameModeUI() {
    if (gameMode === 'scoring') {
        if (scoreboard) {
            // Position the scoreboard above the lane
            if (laneObject) {
                const lanePosition = laneObject.mesh.position;
                scoreboard.position.set(lanePosition.x, lanePosition.y + 1.5, lanePosition.z - 2);
            }
            scoreboard.visible = true;
            startNewGame();
        }
    } else { // 'freeplay'
        if (scoreboard) {
            scoreboard.visible = false;
        }
    }
}

function createScoreboard() {
    const canvas = document.createElement('canvas');
    canvas.width = 2048; // High res for sharp text
    canvas.height = 256;
    const context = canvas.getContext('2d');

    const texture = new THREE.CanvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(3.5, 0.42); // A larger, wide banner
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });

    const boardMesh = new THREE.Mesh(geometry, material);
    boardMesh.name = "scoreboard";
    boardMesh.userData.canvas = canvas;
    boardMesh.userData.context = context;

    boardMesh.visible = false; // Initially hidden
    scene.add(boardMesh);

    return boardMesh;
}

function drawScoreboard() {
    if (!scoreboard) return;

    const ctx = scoreboard.userData.context;
    const canvas = scoreboard.userData.canvas;

    // Clear canvas with a dark blue background
    ctx.fillStyle = '#000033';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Define layout constants
    const frameWidth = (canvas.width - 40) / 11; // 10 frames + 1 total box
    const frameHeight = canvas.height - 40;
    const startX = 20;
    const startY = 20;
    const smallBoxSize = frameWidth / 3.5;

    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.fillStyle = 'white';

    // Draw the 10 frames + total box
    let cumulativeTotal = 0;
    for (let i = 0; i < 11; i++) {
        const x = startX + i * frameWidth;

        if (i < 10) { // Frames 1-10
            // Main frame box
            ctx.strokeRect(x, startY, frameWidth, frameHeight);

            // Line for frame score
            ctx.beginPath();
            ctx.moveTo(x, startY + smallBoxSize);
            ctx.lineTo(x + frameWidth, startY + smallBoxSize);
            ctx.stroke();

            // Frame score text
            const frameScore = scoreData[i].frameScore || '';
            cumulativeTotal += parseInt(frameScore) || 0;
            ctx.font = '60px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(frameScore, x + frameWidth / 2, startY + smallBoxSize + (frameHeight - smallBoxSize) / 2);

            if (i < 9) { // Frames 1-9 have 2 roll boxes
                ctx.strokeRect(x + frameWidth - 2 * smallBoxSize, startY, smallBoxSize, smallBoxSize);
                ctx.strokeRect(x + frameWidth - smallBoxSize, startY, smallBoxSize, smallBoxSize);

                ctx.font = '30px sans-serif';
                ctx.fillText(scoreData[i].rolls[0], x + frameWidth - (1.5 * smallBoxSize), startY + smallBoxSize / 2);
                ctx.fillText(scoreData[i].rolls[1], x + frameWidth - (0.5 * smallBoxSize), startY + smallBoxSize / 2);

            } else { // 10th Frame has 3 roll boxes
                ctx.strokeRect(x + frameWidth - 3 * smallBoxSize, startY, smallBoxSize, smallBoxSize);
                ctx.strokeRect(x + frameWidth - 2 * smallBoxSize, startY, smallBoxSize, smallBoxSize);
                ctx.strokeRect(x + frameWidth - smallBoxSize, startY, smallBoxSize, smallBoxSize);

                ctx.font = '30px sans-serif';
                ctx.fillText(scoreData[i].rolls[0], x + frameWidth - (2.5 * smallBoxSize), startY + smallBoxSize / 2);
                ctx.fillText(scoreData[i].rolls[1], x + frameWidth - (1.5 * smallBoxSize), startY + smallBoxSize / 2);
                ctx.fillText(scoreData[i].rolls[2], x + frameWidth - (0.5 * smallBoxSize), startY + smallBoxSize / 2);
            }
        } else { // Final "Total" box
            ctx.strokeRect(x, startY, frameWidth, frameHeight);
            const totalScore = cumulativeTotal.toString();
            ctx.font = '60px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(totalScore, x + frameWidth / 2, startY + frameHeight / 2);
        }
    }

    scoreboard.material.map.needsUpdate = true;
}

function startNewGame() {
    // Ensure any open dialogs like "Play Again?" are closed.
    dismissConfirmationDialog();

    // This is the code for a clean, empty scoreboard.
    scoreData = [];
    for (let i = 0; i < 10; i++) {
        scoreData.push({
            rolls: i < 9 ? ['', ''] : ['', '', ''],
            frameScore: ''
        });
    }
    currentFrame = 0;
    currentRoll = 0;
    isGameOver = false;
    pinsDownLastRoll = 0;

    // We need to make sure pins are reset when a new scoring game starts
    if (world) { // Check if physics world is ready
        resetPins();
    }

    drawScoreboard();
}

function calculateScores() {
    let cumulativeScore = 0;

    // Helper to get the numeric value of a single roll
    const getRollValue = (frame, roll) => {
        const rollStr = scoreData[frame].rolls[roll];
        if (rollStr === '') return null;
        if (rollStr === 'X') return 10;
        // For a spare, its value is 10 minus the previous roll in that frame.
        if (rollStr === '/') return 10 - parseInt(scoreData[frame].rolls[roll - 1]);
        return parseInt(rollStr);
    };

    // --- Frames 1-9 ---
    for (let i = 0; i < 9; i++) {
        if (scoreData[i].rolls[0] === '') {
            scoreData[i].frameScore = '';
            continue;
        }

        let frameScore = 0;
        const isStrike = scoreData[i].rolls[0] === 'X';
        const isSpare = scoreData[i].rolls[1] === '/';

        if (isStrike) {
            const nextRoll = getRollValue(i + 1, 0);
            let secondNextRoll;
            if (nextRoll === 10) { // Followed by another strike
                // Look ahead to the frame after that, or the 2nd roll of the 10th frame
                secondNextRoll = (i < 8) ? getRollValue(i + 2, 0) : getRollValue(9, 1);
            } else { // Not a double
                secondNextRoll = getRollValue(i + 1, 1);
            }

            if (nextRoll === null || secondNextRoll === null) {
                scoreData[i].frameScore = ''; continue;
            }
            frameScore = 10 + nextRoll + secondNextRoll;

        } else if (isSpare) {
            const nextRoll = getRollValue(i + 1, 0);
            if (nextRoll === null) {
                scoreData[i].frameScore = ''; continue;
            }
            frameScore = 10 + nextRoll;

        } else { // Open frame
            const roll1 = getRollValue(i, 0);
            const roll2 = getRollValue(i, 1);
            if (roll1 === null || roll2 === null) {
                scoreData[i].frameScore = ''; continue;
            }
            frameScore = roll1 + roll2;
        }

        cumulativeScore += frameScore;
        scoreData[i].frameScore = cumulativeScore.toString();
    }

    // --- Frame 10 ---
    const frame10 = scoreData[9];
    if (frame10.rolls[0] !== '') {
        const roll1Val = getRollValue(9, 0);
        if (roll1Val === null) {
            frame10.frameScore = '';
            return;
        }

        const roll2Val = getRollValue(9, 1);
        if (roll2Val === null) {
            frame10.frameScore = '';
            return;
        }

        let frameScore = 0;
        const isStrike = roll1Val === 10;
        const isSpare = !isStrike && (roll1Val + roll2Val === 10);

        if (isStrike || isSpare) {
            const roll3Val = getRollValue(9, 2);
            if (roll3Val !== null) {
                frameScore = roll1Val + roll2Val + roll3Val;
                cumulativeScore += frameScore;
                frame10.frameScore = cumulativeScore.toString();
            } else {
                frame10.frameScore = ''; // Waiting for third roll
            }
        } else {
            // Open 10th frame, no third roll
            frameScore = roll1Val + roll2Val;
            cumulativeScore += frameScore;
            frame10.frameScore = cumulativeScore.toString();
        }
    } else {
        frame10.frameScore = '';
    }
}

function processStandardFrameRoll(fallenPins, fallenThisRoll) {
    if (currentRoll === 0) { // First roll
        if (fallenPins.length === 10) { // Strike
            scoreData[currentFrame].rolls[0] = 'X';
            currentFrame++;
            pinsDownLastRoll = 0;
            resetPins();
        } else {
            scoreData[currentFrame].rolls[0] = fallenThisRoll.toString();
            pinsDownLastRoll = fallenPins.length;
            currentRoll++;
            clearFallenPins();
        }
    } else { // Second roll
        if (fallenPins.length === 10) { // Spare
            scoreData[currentFrame].rolls[1] = '/';
        } else {
            scoreData[currentFrame].rolls[1] = fallenThisRoll.toString();
        }
        currentFrame++;
        currentRoll = 0;
        pinsDownLastRoll = 0;
        resetPins();
    }
}

function processTenthFrameRoll(fallenPins, fallenThisRoll) {
    const frame = scoreData[9];

    if (currentRoll === 0) { // First roll
        frame.rolls[0] = fallenThisRoll === 10 ? 'X' : fallenThisRoll.toString();
        if (fallenThisRoll === 10) { // Strike
            resetPins();
            pinsDownLastRoll = 0;
        } else {
            clearFallenPins();
            pinsDownLastRoll = fallenPins.length;
        }
        currentRoll++;
    } else if (currentRoll === 1) { // Second roll
        const firstRollWasStrike = frame.rolls[0] === 'X';

        if (firstRollWasStrike) {
            // This is the first bonus ball after a strike. Rack was full.
            const pinsThisThrow = fallenPins.length;
            frame.rolls[1] = pinsThisThrow === 10 ? 'X' : pinsThisThrow.toString();
            if (pinsThisThrow === 10) { // Second strike
                resetPins();
                pinsDownLastRoll = 0;
            } else {
                clearFallenPins();
                pinsDownLastRoll = fallenPins.length;
            }
        } else {
            // This is the second ball of a standard frame.
            if (fallenPins.length === 10) { // Spare
                frame.rolls[1] = '/';
                resetPins(); // Reset for bonus ball
                pinsDownLastRoll = 0;
            } else { // Open frame
                frame.rolls[1] = fallenThisRoll.toString();
                isGameOver = true; // Game over, no third roll
            }
        }
        // If we're not game over, we advance to the third roll
        if (!isGameOver) {
            currentRoll++;
        }
    } else if (currentRoll === 2) { // Third roll (bonus ball)
        const firstRollWasStrike = frame.rolls[0] === 'X';
        const secondRollWasStrike = frame.rolls[1] === 'X';

        if (firstRollWasStrike && secondRollWasStrike) {
            // Third strike in a row. Rack was full.
            frame.rolls[2] = fallenPins.length === 10 ? 'X' : fallenPins.length.toString();
        } else if (firstRollWasStrike) {
            // First was strike, second was not. Partial rack.
            frame.rolls[2] = fallenPins.length === 10 ? '/' : fallenThisRoll.toString();
        } else {
            // First was not strike, second was a spare. Rack is full.
            frame.rolls[2] = fallenPins.length === 10 ? 'X' : fallenPins.length.toString();
        }
        isGameOver = true;
    }
}

function processRoll() {
    if (isGameOver) return;

    const fallenPins = getFallenPins();
    const fallenThisRoll = fallenPins.length - pinsDownLastRoll;

    if (currentFrame === 9) {
        processTenthFrameRoll(fallenPins, fallenThisRoll);
    } else {
        processStandardFrameRoll(fallenPins, fallenThisRoll);
    }

    calculateScores();
    drawScoreboard();

    if (isGameOver) {
        activeConfirmationDialog = createConfirmationDialog(
            'Game Over! Play Again?',
            [
                { text: 'No', action: 'dismiss' },
                { text: 'Yes', action: 'startNewGame' }
            ],
            renderer
        );
        scene.add(activeConfirmationDialog);
    }
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
    hudMesh.userData.canvas = canvas;
    hudMesh.userData.context = context;

    hudMesh.visible = false; // Initially hidden
    scene.add(hudMesh);

    return hudMesh;
}

function drawPinHUD() {
    if (!pinHUD) return;

    const ctx = pinHUD.userData.context;
    const canvas = pinHUD.userData.canvas;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Pin positions in a standard bowling triangle layout
    const pinLayout = [
        { x: 128, y: 200 }, // Pin 1 (front)
        { x: 108, y: 170 }, { x: 148, y: 170 }, // Row 2
        { x: 88, y: 140 }, { x: 128, y: 140 }, { x: 168, y: 140 }, // Row 3
        { x: 68, y: 110 }, { x: 108, y: 110 }, { x: 148, y: 110 }, { x: 188, y: 110 }, // Row 4
    ];

    // Draw triangle outline
    ctx.beginPath();
    ctx.moveTo(pinLayout[0].x, pinLayout[0].y + 20); // Bottom point
    ctx.lineTo(pinLayout[6].x - 20, pinLayout[6].y - 20); // Top-left
    ctx.lineTo(pinLayout[9].x + 20, pinLayout[9].y - 20); // Top-right
    ctx.closePath();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();

    const pins = dynamicObjects.filter(obj => obj.isPin);

    pinLayout.forEach((pos, index) => {
        let isStanding = false;
        const pin = pins.find(p => p.pinId === index); // Find pin by its unique ID
        if (pin) {
            const up = new THREE.Vector3(0, 1, 0);
            const quaternion = new THREE.Quaternion().copy(pin.body.rotation());
            const pinUp = up.clone().applyQuaternion(quaternion);
            isStanding = pinUp.y >= 0.5;
        }

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 12, 0, 2 * Math.PI);
        ctx.fillStyle = isStanding ? 'white' : '#555';
        ctx.fill();
    });

    pinHUD.material.map.needsUpdate = true;
}

function createDebugDisplay() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext('2d');

    const texture = new THREE.CanvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(0.8, 0.4);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });

    const displayMesh = new THREE.Mesh(geometry, material);
    displayMesh.userData.canvas = canvas;
    displayMesh.userData.context = context;

    return displayMesh;
}

function updateDebugDisplay(gamepad) {
    if (!debugDisplay || !gamepad) return;

    const context = debugDisplay.userData.context;
    const canvas = debugDisplay.userData.canvas;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.font = '20px sans-serif';

    gamepad.buttons.forEach((button, index) => {
        const x = 20 + (index % 6) * 80;
        const y = 40 + Math.floor(index / 6) * 100;

        // Draw button state indicator
        context.fillStyle = button.pressed ? 'green' : 'red';
        context.fillRect(x, y, 50, 50);

        // Draw button index label
        context.fillStyle = 'white';
        context.textAlign = 'center';
        context.fillText(index, x + 25, y + 80);
    });

    debugDisplay.material.map.needsUpdate = true;
}

async function main() {
    await RAPIER.init();

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    world = new RAPIER.World(gravity);
    world.integrationParameters.dt = 1/120; //90fps ?

    const loader = new GLTFLoader();

    const isPWA = window.matchMedia('(display-mode: standalone)').matches;

    if (!isPWA) {
        // This is not a PWA, so show the AR button for the standard web experience.
        const arButton = ARButton.createButton(renderer, {
            requiredFeatures: ['local-floor', 'plane-detection']
        });
        document.body.appendChild(arButton);
    }

    renderer.xr.addEventListener('sessionstart', () => {
        const setupScene = async () => {
            let fY = 0;
            // Wait for a plane to be detected
            await new Promise(resolve => {
                const checkFloor = setInterval(() => {
                    if (planes.children.length > 0) {
                        for (const planeMesh of planes.children) {
                            fY = planeMesh.position.y < fY ? planeMesh.position.y : fY;
                        }
                        clearInterval(checkFloor);
                        resolve();
                    }
                }, 150);
            });

            fY_floor = fY;
            await placeScene(fY, loader, world, dynamicObjects); // Await the async function
            updateGameModeUI(); // Now this runs after placeScene is complete

            // Position and show the debug display once the world is set up
            if (showButtons && debugDisplay) {
                const cameraPosition = new THREE.Vector3();
                camera.getWorldPosition(cameraPosition);
                const cameraQuaternion = new THREE.Quaternion();
                camera.getWorldQuaternion(cameraQuaternion);
                const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraQuaternion);

                debugDisplay.position.copy(cameraPosition).add(forward.multiplyScalar(1.5));
                debugDisplay.position.y += 0.5; // Place it a bit higher
                debugDisplay.quaternion.copy(cameraQuaternion);
                debugDisplay.visible = true;
            }
        };

        setupScene();
    });

    renderer.xr.addEventListener('sessionend', cleanupScene);

    // Setup plane detection
    planes = new XRPlanes(renderer);
    //scene.add(planes);

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

    if (pinHUD && pinHUD.visible) {
        drawPinHUD();
    }

    if (renderer.xr.isPresenting) {
        const pins = dynamicObjects.filter(obj => obj.isPin);
        if (pins.length > 0) {
            const fallenPins = getFallenPins();

            if (fallenPins.length === pins.length && !allPinsFallen) {
                allPinsFallen = true;
                // In scoring mode, roll completion handles reset. In freeplay, use a timer.
                if (gameMode === 'freeplay') {
                    pinsFallenResetTimer = setTimeout(() => {
                        resetPins();
                        pinsFallenResetTimer = null;
                    }, 4000);
                }
            }
        }

        // --- SCORING LOGIC: Roll Completion Detection ---
        if (gameMode === 'scoring' && isBallThrown && !isGameOver) {
            const ball = dynamicObjects.find(obj => obj.isBall);
            if (ball) {
                const isSleeping = ball.body.isSleeping();
                const ballLocation = getBallLocationState();
                const isOutOfPlay = ballLocation === 'gutter' || ballLocation === 'ground';

                if (isSleeping || isOutOfPlay) {
                    isBallThrown = false; // Prevent this from running again until next throw
                    processRoll();
                }
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
                const dialogOpen = (optionsMenu && optionsMenu.visible) || activeConfirmationDialog;

                // --- DIALOG INPUT HANDLING ---
                if (dialogOpen) {
                    // --- Generic Confirmation Dialog ---
                    if (activeConfirmationDialog) {
                        const dialog = activeConfirmationDialog;
                        // Navigation with thumbsticks
                        const thumbstickX = controller.gamepad.axes[2];
                        if (thumbstickX < -0.5 && thumbstickXState[i] !== -1) { // Left
                            thumbstickXState[i] = -1;
                            dialog.userData.selectedIndex = Math.max(0, dialog.userData.selectedIndex - 1);
                            dialog.userData.update();
                        } else if (thumbstickX > 0.5 && thumbstickXState[i] !== 1) { // Right
                            thumbstickXState[i] = 1;
                            dialog.userData.selectedIndex = Math.min(dialog.userData.buttons.length - 1, dialog.userData.selectedIndex + 1);
                            dialog.userData.update();
                        } else if (Math.abs(thumbstickX) < 0.2) { // Neutral
                            thumbstickXState[i] = 0;
                        }

                        // Confirm with A/X/Trigger
                        const confirmButtonPressed = (controller.gamepad.buttons[0].pressed && !triggerState[i]) || (controller.gamepad.buttons[4].pressed && !resetButtonState[i]);
                        if (confirmButtonPressed) {
                            if (controller.gamepad.buttons[0].pressed) triggerState[i] = true;
                            if (controller.gamepad.buttons[4].pressed) resetButtonState[i] = true;

                            const selectedButton = dialog.userData.buttons[dialog.userData.selectedIndex];
                            const action = selectedButton.userData.action;

                            switch (action) {
                                case 'dismiss':
                                    activeConfirmationDialog.userData.dismiss();
                                    break;
                                case 'exit':
                                    renderer.xr.getSession().end();
                                    break;
                                case 'reset':
                                    resetPins();
                                    activeConfirmationDialog.userData.dismiss();
                                    break;
                                case 'startNewGame':
                                    startNewGame();
                                    activeConfirmationDialog.userData.dismiss();
                                    break;
                            }
                        }

                        // Cancel with B/Y
                        if (controller.gamepad.buttons[5].pressed && !endSessionButtonState[i]) {
                            endSessionButtonState[i] = true;
                            activeConfirmationDialog.userData.dismiss();
                        }
                    }

                    // --- Options Menu Dialog ---
                    if (optionsMenu && optionsMenu.visible) {
                        const buttons = optionsMenu.userData.buttons;
                        // Navigation with thumbsticks (either controller)
                        const thumbstickY = controller.gamepad.axes[3];
                        if (thumbstickY < -0.5 && thumbstickYState[i] !== -1) { // Up
                            thumbstickYState[i] = -1;
                            const oldIndex = selectedMenuIndex;
                            selectedMenuIndex = Math.max(0, selectedMenuIndex - 1);
                            if (oldIndex !== selectedMenuIndex) {
                                optionsMenu.userData.update();
                            }
                        } else if (thumbstickY > 0.5 && thumbstickYState[i] !== 1) { // Down
                            thumbstickYState[i] = 1;
                            const oldIndex = selectedMenuIndex;
                            selectedMenuIndex = Math.min(buttons.length - 1, selectedMenuIndex + 1);
                            if (oldIndex !== selectedMenuIndex) {
                                optionsMenu.userData.update();
                            }
                        } else if (Math.abs(thumbstickY) < 0.2) { // Neutral
                            thumbstickYState[i] = 0;
                        }

                        // Confirm selection with A/X/Trigger (buttons 0, 4)
                        const confirmButtonPressed = (controller.gamepad.buttons[0].pressed && !triggerState[i]) || (controller.gamepad.buttons[4].pressed && !resetButtonState[i]);
                        if (confirmButtonPressed) {
                            if (controller.gamepad.buttons[0].pressed) triggerState[i] = true;
                            if (controller.gamepad.buttons[4].pressed) resetButtonState[i] = true;

                            const selectedButton = buttons[selectedMenuIndex];
                            if (selectedButton) {
                                gameMode = selectedButton.userData.mode;
                                localStorage.setItem('gameMode', gameMode);
                                optionsMenu.visible = false;
                                updateGameModeUI();
                            }
                        }

                        // Cancel with B/Y (button 5)
                        if (controller.gamepad.buttons[5].pressed && !endSessionButtonState[i]) {
                            endSessionButtonState[i] = true;
                            optionsMenu.visible = false; // Just close it
                        }
                    }

                    // Handle button release states for dialog controls
                    if (!controller.gamepad.buttons[0].pressed) triggerState[i] = false;
                    if (!controller.gamepad.buttons[4].pressed) resetButtonState[i] = false;
                    if (!controller.gamepad.buttons[5].pressed) endSessionButtonState[i] = false;
                    if (Math.abs(controller.gamepad.axes[2]) < 0.2) thumbstickXState[i] = 0;

                }
                // --- DEFAULT GAME INPUT HANDLING ---
                else {
                    // Handle floor height adjustment with grip and thumbstick
                    const ballLocation = getBallLocationState();
                    const canAdjust = ballLocation !== 'lane';

                    if (controller.gamepad.buttons[1].pressed && canAdjust) { // Grip button
                        if (!gripButtonState[i]) {
                            gripButtonState[i] = true;
                            const pins = dynamicObjects.filter(obj => obj.isPin);
                            pins.forEach(pin => pin.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased));
                        }

                        const thumbstickY = controller.gamepad.axes[3];
                        if (Math.abs(thumbstickY) > 0.1) {
                            const yDelta = thumbstickY * -0.01;
                            floorOffset += yDelta;
                            updateFloorAndLanePosition(yDelta);
                            if (floorOffsetSaveTimer) clearTimeout(floorOffsetSaveTimer);
                            floorOffsetSaveTimer = setTimeout(() => {
                                localStorage.setItem('floorOffset', floorOffset);
                                floorOffsetSaveTimer = null;
                            }, 120000);
                        }
                    } else if (gripButtonState[i]) {
                        gripButtonState[i] = false;
                        const pins = dynamicObjects.filter(obj => obj.isPin);
                        pins.forEach(pin => pin.body.setBodyType(RAPIER.RigidBodyType.Dynamic));
                    }

                    // Handle B/Y button (index 5) for initiating exit
                    if (controller.gamepad.buttons[5].pressed && !endSessionButtonState[i]) {
                        endSessionButtonState[i] = true;

                        activeConfirmationDialog = createConfirmationDialog(
                            'Exit Game?',
                            [
                                { text: 'No', action: 'dismiss' },
                                { text: 'Yes', action: 'exit' }
                            ],
                            renderer
                        );
                        scene.add(activeConfirmationDialog);

                    } else if (!controller.gamepad.buttons[5].pressed) {
                        endSessionButtonState[i] = false;
                    }

                    // Handle A/X button (index 4) for initiating a reset
                    if (controller.gamepad.buttons[4].pressed && !resetButtonState[i]) {
                        resetButtonState[i] = true;

                        if (gameMode === 'scoring') {
                            activeConfirmationDialog = createConfirmationDialog(
                                'Reset the game?',
                                [
                                    { text: 'No', action: 'dismiss' },
                                    { text: 'Yes', action: 'reset' }
                                ],
                                renderer
                            );
                            scene.add(activeConfirmationDialog);
                        } else { // freeplay mode
                            resetPins();
                        }

                    } else if (!controller.gamepad.buttons[4].pressed) {
                        resetButtonState[i] = false;
                    }
                }

                // --- UNIVERSAL INPUT HANDLING ---
                // Update debug display for the left controller
                if (showButtons && i === 0) {
                    updateDebugDisplay(controller.gamepad);
                }

                // Handle options menu toggle (left controller, options button is 12)
                if (i === 0) { // Left controller
                    if (controller.gamepad.buttons[12] && controller.gamepad.buttons[12].pressed && !menuButtonState) {
                        menuButtonState = true;
                        if (optionsMenu) {
                            // If menu is already visible, this press is a CONFIRM action
                            if (optionsMenu.visible) {
                                const selectedButton = optionsMenu.userData.buttons[selectedMenuIndex];
                                if (selectedButton) {
                                    gameMode = selectedButton.userData.mode;
                                    localStorage.setItem('gameMode', gameMode);
                                    updateGameModeUI();
                                }
                                optionsMenu.visible = false;
                            } else {
                                // If menu is not visible, this press OPENS it
                                optionsMenu.visible = true;

                                // Find index of current game mode and set it as selected
                                const currentModeIndex = optionsMenu.userData.buttons.findIndex(button => button.userData.mode === gameMode);
                                selectedMenuIndex = currentModeIndex !== -1 ? currentModeIndex : 0;
                                optionsMenu.userData.update();

                                const cameraPosition = new THREE.Vector3();
                                camera.getWorldPosition(cameraPosition);
                                const cameraQuaternion = new THREE.Quaternion();
                                camera.getWorldQuaternion(cameraQuaternion);
                                const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraQuaternion);
                                optionsMenu.position.copy(cameraPosition).add(forward.multiplyScalar(1.5));
                                optionsMenu.quaternion.copy(cameraQuaternion);
                            }
                        }
                    } else if (controller.gamepad.buttons[12] && !controller.gamepad.buttons[12].pressed) {
                        menuButtonState = false;
                    }
                }

                // Handle Pin HUD toggle (left controller, thumbstick press is 3)
                if (i === 0) { // Left controller
                    if (controller.gamepad.buttons[3] && controller.gamepad.buttons[3].pressed && !hudButtonState) {
                        hudButtonState = true;
                        if (pinHUD) {
                            pinHUD.visible = !pinHUD.visible;
                            if (pinHUD.visible && laneObject) {
                                const lanePosition = laneObject.mesh.position;
                                pinHUD.position.set(lanePosition.x, lanePosition.y + 2.0, lanePosition.z - 2);
                                if (scoreboard) {
                                    pinHUD.quaternion.copy(scoreboard.quaternion);
                                }
                            }
                        }
                    } else if (controller.gamepad.buttons[3] && !controller.gamepad.buttons[3].pressed) {
                        hudButtonState = false;
                    }
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

            if (showCollision){
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
        }
    });

    scene.add(groundMesh);

    // Set the initial position for all lane components using the new function
    const initialPosition = new THREE.Vector3(0, fY, -2);
    setLanePosition(initialPosition);

    // Create an infinite floor plane to prevent objects from falling through
    const floorBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, fY_floor - 0.25, 0);
    floorBody = world.createRigidBody(floorBodyDesc);
    const floorColliderDesc = RAPIER.ColliderDesc.cuboid(100, 0.1, 100) // Large cuboid for the floor
        .setCollisionGroups(FLOOR_COLLISION_GROUP)
        .setRestitution(0.2);
    world.createCollider(floorColliderDesc, floorBody);

    // Apply initial floor offset from localStorage
    updateFloorAndLanePosition();

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
    const ballColliderDesc = RAPIER.ColliderDesc.ball(ballRadius).setRestitution(0.01).setMass(9999).setFriction(.8).setCollisionGroups(BALL_COLLISION_GROUP);
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
    let pinIdCounter = 0;

    function createPin(x, z, id) {
        const pinMesh = pinModel.clone();
        const initialPosition = { x: x, y: fY, z: z };
        const pinBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(initialPosition.x, initialPosition.y, initialPosition.z);
        const pinBody = world.createRigidBody(pinBodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.convexHull(pinVertices).setCollisionGroups(PINS_COLLISION_GROUP);
        const collider = world.createCollider(colliderDesc, pinBody);
        dynamicObjects.push({ mesh: pinMesh, body: pinBody, initialPosition: initialPosition, isPin: true, pinId: id });
        scene.add(pinMesh);
        pinMesh.visible = true;
    }

    const pinSpacing = 0.2;
    const pinStartZ = -7; //where pins are located!

    for (let row = 0; row < 4; row++) {
        for (let i = 0; i < row + 1; i++) {
            const x = (i - row / 2) * pinSpacing * 2;
            const z = pinStartZ - row * pinSpacing * 1.732;
            createPin(x, z, pinIdCounter++);
        }
    }
}

function clearFallenPins() {
    // This function correctly removes fallen pins from the simulation.
    // 1. It gets a list of fallen pins.
    // 2. It removes the visual mesh from the Three.js scene.
    // 3. It removes the physics body from the Rapier world.
    // 4. It filters the pin object out of the master dynamicObjects array,
    //    ensuring it's gone from all future physics steps and lookups.
    const fallenPins = getFallenPins();
    if (fallenPins.length > 0) {
        for (const pin of fallenPins) {
            scene.remove(pin.mesh);
            world.removeRigidBody(pin.body);
        }
        // Filter out the removed pins from dynamicObjects
        dynamicObjects = dynamicObjects.filter(obj => !fallenPins.includes(obj));
    }
}

function getFallenPins() {
    const fallenPins = [];
    const pins = dynamicObjects.filter(obj => obj.isPin);

    for (const pin of pins) {
        // Check orientation
        const up = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().copy(pin.body.rotation());
        const pinUp = up.clone().applyQuaternion(quaternion);
        const isTippedOver = pinUp.y < 0.5;

        if (isTippedOver) {
            fallenPins.push(pin);
        }
    }
    return fallenPins;
}

function resetPins() {
    // The confirmation dialog is dismissed by the input handler that calls this.
    // No need to dismiss it here.
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
    createPins(fY_floor + floorOffset);
}

function getBallLocationState() {
    if (holdingController) {
        return 'in-hand';
    }

    const ball = dynamicObjects.find(obj => obj.isBall);
    if (!ball) {
        return 'noball';
    }

    const position = ball.body.translation();
    const adjustedFloorY = fY_floor + floorOffset;

    if (position.y < adjustedFloorY + 0.1 && position.y > adjustedFloorY) {
        return 'gutter';
    } else if (position.y < adjustedFloorY) {
        return 'ground';
    } else {
        return 'lane';
    }
}


function createConfirmationDialog(title, buttons, renderer) {
    const dialog = new THREE.Group();
    dialog.name = "confirmationDialog";
    dialog.userData.buttons = [];
    dialog.userData.selectedIndex = 0; // Default to the first button ("No")

    // Background panel
    const panelGeo = new THREE.PlaneGeometry(0.8, 0.4);
    const panelMat = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.9 });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    dialog.add(panel);

    // Title text
    const titleCanvas = document.createElement('canvas');
    titleCanvas.width = 512;
    titleCanvas.height = 128;
    const titleContext = titleCanvas.getContext('2d');
    titleContext.fillStyle = 'white';
    titleContext.font = 'bold 40px sans-serif';
    titleContext.textAlign = 'center';
    titleContext.textBaseline = 'middle';
    titleContext.fillText(title, titleCanvas.width / 2, titleCanvas.height / 2);
    const titleTexture = new THREE.CanvasTexture(titleCanvas);
    const titleGeo = new THREE.PlaneGeometry(0.7, 0.1);
    const titleMat = new THREE.MeshBasicMaterial({ map: titleTexture, transparent: true });
    const titleMesh = new THREE.Mesh(titleGeo, titleMat);
    titleMesh.position.y = 0.1;
    titleMesh.position.z = 0.01;
    dialog.add(titleMesh);

    // Function to draw a single button
    const updateButtonAppearance = (button, selected) => {
        const context = button.userData.context;
        const canvas = button.userData.canvas;
        context.fillStyle = '#444';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = selected ? '#0F0' : '#888'; // Green for selected, grey for default
        context.lineWidth = 10;
        context.strokeRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = 'white';
        context.font = 'bold 40px sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(button.userData.text, canvas.width / 2, canvas.height / 2);
        button.material.map.needsUpdate = true;
    };

    // Create and position buttons
    const totalWidth = (buttons.length - 1) * 0.3;
    const startX = -totalWidth / 2;

    buttons.forEach((btn, index) => {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const context = canvas.getContext('2d');

        const texture = new THREE.CanvasTexture(canvas);
        const geometry = new THREE.PlaneGeometry(0.25, 0.15);
        const material = new THREE.MeshBasicMaterial({ map: texture });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.x = startX + index * 0.3;
        mesh.position.y = -0.1;
        mesh.position.z = 0.01;
        mesh.userData = {
            ...btn,
            isButton: true,
            canvas: canvas,
            context: context,
        };

        dialog.userData.buttons.push(mesh);
        dialog.add(mesh);

        updateButtonAppearance(mesh, index === dialog.userData.selectedIndex);
    });

    // Add an update method to the dialog itself
    dialog.userData.update = () => {
        dialog.userData.buttons.forEach((btn, index) => {
            updateButtonAppearance(btn, index === dialog.userData.selectedIndex);
        });
    };

    // Add a dismiss method
    dialog.userData.dismiss = () => {
        scene.remove(dialog);
        activeConfirmationDialog = null;
    };

    // Position the dialog in front of the camera
    const camera = renderer.xr.getCamera();
    const cameraPosition = new THREE.Vector3();
    camera.getWorldPosition(cameraPosition);
    const cameraQuaternion = new THREE.Quaternion();
    camera.getWorldQuaternion(cameraQuaternion);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraQuaternion);
    dialog.position.copy(cameraPosition).add(forward.multiplyScalar(2));
    dialog.quaternion.copy(cameraQuaternion);

    return dialog;
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

    // If pins are kinematic (i.e., being moved with the floor), update their position too.
    const pins = dynamicObjects.filter(obj => obj.isPin);
    pins.forEach(pin => {
        if (pin.body.bodyType() === RAPIER.RigidBodyType.KinematicPositionBased) {
            const currentPos = pin.body.translation();
            pin.body.setNextKinematicTranslation({
                x: currentPos.x,
                y: currentPos.y + yDelta,
                z: currentPos.z
            });
        }
    });
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
    if (activeConfirmationDialog) {
        activeConfirmationDialog.userData.dismiss();
    }

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

    optionsMenu = createOptionsMenu();
    scoreboard = createScoreboard();
    pinHUD = createPinHUD();
    if (showButtons) {
        debugDisplay = createDebugDisplay();
        scene.add(debugDisplay);
        debugDisplay.visible = false; // Initially hidden
    }

    placementMatrix = new THREE.Matrix4();

    renderer.setAnimationLoop(animate);

    function onSelectStart(event) {
        const controller = event.target;
        if (holdingController === null) {
            const ball = dynamicObjects.find(obj => obj.isBall);
            if (ball) {
                const linvel = ball.body.linvel();
                const isMoving = new THREE.Vector3(linvel.x, linvel.y, linvel.z).length() > 0.1;
                const ballLocation = getBallLocationState();

                const isBelowLane = ballLocation === 'gutter' || ballLocation === 'ground';

                if (!isMoving || isBelowLane) {
                    // If the ball is not moving or has fallen, clear the fallen pins
                    clearFallenPins();

                    // Set the collision group immediately to prevent collision on the next physics step.
                    ball.collider.setCollisionGroups(HELD_BALL_COLLISION_GROUP);
                    // Register the intent to hold, which will be processed in the animate loop after the next physics step.
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
                ball.collider.setCollisionGroups(BALL_COLLISION_GROUP); // Re-enable collision with pins
                ball.body.setBodyType(RAPIER.RigidBodyType.Dynamic);

                // Apply the controller's velocity to the ball
                const throwVelocityMultiplier = 1.1;
                const linearVelocity = controller.userData.linearVelocity.clone().multiplyScalar(throwVelocityMultiplier);
                const angularVelocity = controller.userData.angularVelocity.clone();//.multiplyScalar(throwVelocityMultiplier);

                ball.body.setLinvel(linearVelocity, true);
                ball.body.setAngvel(angularVelocity, true);
                isBallThrown = true;
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

    const isPWA = window.matchMedia('(display-mode: standalone)').matches;

    if (isPWA) {
        // This is a PWA on Meta Quest, so we can autostart VR.
        // The user clicking the PWA icon from the app library counts as the required user gesture.
        if (navigator.xr && navigator.xr.isSessionSupported) {
            navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
              if (supported) {
                navigator.xr.requestSession('immersive-vr', {
                  optionalFeatures: ['local-floor','plane-detection'],
                })
                .then((session) => {renderer.xr.setSession(session);});
              }
            });
        }
    }
}

main();