// BUTTONS [ trigger:0, grip:1, stick: 3, A/X: 4, B/Y: 5, options: 12 ]
const dbg = 0;

class AudioManager {
    constructor() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.setValueAtTime(2.0, this.audioContext.currentTime);
        this.masterGain.connect(this.audioContext.destination);
        //this.audioContext.volume = 1;

        this.rollingSound = null;
        this.brownNoiseBuffer = this._createBrownNoise();
        this.lastPinHitTime = 0;
    }

    _createBrownNoise() {
        const bufferSize = this.audioContext.sampleRate * 2; // 2 seconds
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = buffer.getChannelData(0);
        let lastOut = 0.0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            output[i] = (lastOut + (0.02 * white)) / 1.02;
            lastOut = output[i];
            output[i] *= 5; // (roughly) compensate for gain
        }
        return buffer;
    }

    playThump() {
        if (!this.audioContext) return;
        const source = this.audioContext.createBufferSource();
        source.buffer = this.brownNoiseBuffer;

        const lowpass = this.audioContext.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.setValueAtTime(100, this.audioContext.currentTime);

        const gainNode = this.audioContext.createGain();
        gainNode.gain.setValueAtTime(5, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(1, this.audioContext.currentTime + 0.25);

        source.connect(lowpass);
        lowpass.connect(gainNode);
        gainNode.connect(this.masterGain);

        source.start();
        source.stop(this.audioContext.currentTime + 0.3);
    }

    startRollingSound() {
        if (this.rollingSound || !this.audioContext) return;
        this.rollingSound = {};
        this.rollingSound.source = this.audioContext.createBufferSource();
        this.rollingSound.source.buffer = this.brownNoiseBuffer;
        this.rollingSound.source.loop = true;

        this.rollingSound.gain = this.audioContext.createGain();
        this.rollingSound.gain.gain.setValueAtTime(0, this.audioContext.currentTime);
        this.rollingSound.gain.gain.linearRampToValueAtTime(0.05, this.audioContext.currentTime + 0.001);

        this.rollingSound.lowpass = this.audioContext.createBiquadFilter();
        this.rollingSound.lowpass.type = 'lowpass';
        this.rollingSound.lowpass.frequency.setValueAtTime(200, this.audioContext.currentTime);

        this.rollingSound.source.connect(this.rollingSound.lowpass);
        this.rollingSound.lowpass.connect(this.rollingSound.gain);
        this.rollingSound.gain.connect(this.masterGain);

        this.rollingSound.source.start();
    }

    stopRollingSound() {
        if (!this.rollingSound) return;
        this.rollingSound.gain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.2);
        this.rollingSound.source.stop(this.audioContext.currentTime + 0.2);
        this.rollingSound = null;
    }

    setRollRate(rate) {
        if (!this.rollingSound) return;
        const clampedRate = Math.max(0.5, Math.min(2.0, rate));
        this.rollingSound.source.playbackRate.setValueAtTime(clampedRate, this.audioContext.currentTime);

        const newFreq = 200 + (clampedRate - 1) * 100;
        this.rollingSound.lowpass.frequency.setValueAtTime(newFreq, this.audioContext.currentTime);
    }

    playPinHit() {
        if (!this.audioContext) return;

        const now = this.audioContext.currentTime;
        if (now - this.lastPinHitTime < 0.05) { // 50ms cooldown
            return;
        }
        this.lastPinHitTime = now;

        // Low-frequency component for "body"
        const brownSource = this.audioContext.createBufferSource();
        brownSource.buffer = this.brownNoiseBuffer;
        const brownGain = this.audioContext.createGain();
        brownGain.gain.setValueAtTime(1, this.audioContext.currentTime);
        brownGain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.2);
        const brownFilter = this.audioContext.createBiquadFilter();
        brownFilter.type = 'lowpass';
        brownFilter.frequency.setValueAtTime(150, this.audioContext.currentTime);
        brownSource.connect(brownFilter);
        brownFilter.connect(brownGain);
        brownGain.connect(this.masterGain);

        // High-frequency component for "crack"
        const whiteBufferSize = this.audioContext.sampleRate * 0.1;
        const whiteBuffer = this.audioContext.createBuffer(1, whiteBufferSize, this.audioContext.sampleRate);
        const whiteOutput = whiteBuffer.getChannelData(0);
        for (let i = 0; i < whiteBufferSize; i++) {
            whiteOutput[i] = Math.random() * 2 - 1;
        }
        const whiteSource = this.audioContext.createBufferSource();
        whiteSource.buffer = whiteBuffer;
        const whiteGain = this.audioContext.createGain();
        whiteGain.gain.setValueAtTime(0.08, this.audioContext.currentTime);
        whiteGain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);
        const whiteFilter = this.audioContext.createBiquadFilter();
        whiteFilter.type = 'highpass';
        whiteFilter.frequency.setValueAtTime(1200, this.audioContext.currentTime);
        whiteSource.connect(whiteFilter);
        whiteFilter.connect(whiteGain);
        whiteGain.connect(this.masterGain);

        brownSource.start();
        //whiteSource.start();
    }
}
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
// Ball collides with heightLane, Pins, and Floor
const BALL_COLLISION_GROUP = (GROUP_BALL << 16) | (GROUP_LANE | GROUP_PINS | GROUP_FLOOR);
// Held ball collides with Floor
const HELD_BALL_COLLISION_GROUP = (GROUP_BALL << 16) | (GROUP_FLOOR);
// Pins collide with the Ball, other Pins, and the Lane and floor
const PINS_COLLISION_GROUP = (GROUP_PINS << 16) | (GROUP_BALL | GROUP_PINS | GROUP_LANE| GROUP_FLOOR);
// Floor collides with the Ball ands pins
const FLOOR_COLLISION_GROUP = (GROUP_FLOOR << 16) | (GROUP_BALL| GROUP_PINS);

const renderer = new THREE.WebGLRenderer({ antialias: true });
const scene = new THREE.Scene();
const gravity = { x: 0.0, y: -9.81 , z: 0.0 };
let world, planes, eventQueue;
let dynamicObjects = [];
let holdingController = null;
let placementMatrix = new THREE.Matrix4();
let camera;
let pinModel, pinVertices, fY_floor, pinHeight;
let floorOffset = parseFloat(localStorage.getItem('floorOffset')) || 0;
let resetButtonState = [false, false];
let endSessionButtonState = [false, false];
let gripButtonState = [false, false];
let triggerState = [false, false];
let gameMode = localStorage.getItem('gameMode') || 'freeplay';
let pinsFallenResetTimer = null;
let rollCompletionTimer = null;
let allPinsFallen = false;
let activeConfirmationDialog = null;
let floorOffsetSaveTimer = null;
let optionsMenu = null;
let menuButtonState = false;
let hudButtonState = [false, false];
let selectedMenuIndex = 0;
let thumbstickYState = [0, 0]; // 0: neutral, 1: up, -1: down
let thumbstickXState = [0, 0]; // 0: neutral, 1: right, -1: left
let audioManager;
let scoreboard = null;
let scoreData = [];
let currentFrame = 0;
let currentRoll = 0;
let isGameOver = false;
let isBallThrown = false;
let ballHasTouchedLane = false;
let pinsDownLastRoll = 0;
let pinHUD = null;
let debugDisplay = null;
let laneObject = null;
let floorBody = null;
let colliderToObjectMap = new Map();
let controllerWantsToHold = null;
let showCollision=0;//debug stuff
let showButtons = 0;
let laneCollisionVisualizer = null;
const loader = new GLTFLoader();
let sceneSetupInitiated = false;

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
                scoreboard.position.set(lanePosition.x, lanePosition.y + 2.0, lanePosition.z - 2);
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
    let lastValidScore = '';
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
            if (frameScore) {
                lastValidScore = frameScore;
            }
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
            const totalScore = lastValidScore;
            ctx.font = '60px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(totalScore, x + frameWidth / 2, startY + frameHeight / 2);
        }
    }

    scoreboard.material.map.needsUpdate = true;
}

function startNewGame() {
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
            currentRoll = 0; // Signals a new frame
        } else {
            scoreData[currentFrame].rolls[0] = fallenThisRoll.toString();
            pinsDownLastRoll = fallenPins.length;
            currentRoll++;
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
    }
}

function processTenthFrameRoll(fallenPins, fallenThisRoll) {
    const frame = scoreData[9];

    if (currentRoll === 0) { // First roll
        frame.rolls[0] = fallenThisRoll === 10 ? 'X' : fallenThisRoll.toString();
        pinsDownLastRoll = fallenPins.length;
        currentRoll++;
    } else if (currentRoll === 1) { // Second roll
        const firstRollWasStrike = frame.rolls[0] === 'X';

        if (firstRollWasStrike) {
            const pinsThisThrow = fallenPins.length;
            frame.rolls[1] = pinsThisThrow === 10 ? 'X' : pinsThisThrow.toString();
            pinsDownLastRoll = fallenPins.length;
        } else {
            if (fallenPins.length === 10) { // Spare
                frame.rolls[1] = '/';
            } else { // Open frame
                frame.rolls[1] = fallenThisRoll.toString();
                isGameOver = true; // Game over, no third roll
            }
            pinsDownLastRoll = fallenPins.length;
        }

        if (!isGameOver) {
            currentRoll++;
        }
    } else if (currentRoll === 2) { // Third roll (bonus ball)
        const firstRollWasStrike = frame.rolls[0] === 'X';
        const secondRollWasStrike = frame.rolls[1] === 'X';

        if (firstRollWasStrike && secondRollWasStrike) {
            frame.rolls[2] = fallenPins.length === 10 ? 'X' : fallenPins.length.toString();
        } else if (firstRollWasStrike) {
            frame.rolls[2] = fallenPins.length === 10 ? '/' : fallenThisRoll.toString();
        } else { // Spare on second roll
            frame.rolls[2] = fallenPins.length === 10 ? 'X' : fallenPins.length.toString();
        }
        isGameOver = true;
    }
}

function endTurn() {
    processRoll(); // This updates currentFrame, currentRoll, and scoreData

    if (isGameOver) {
        return; // Game is over, do nothing.
    }

    let fullPinReset = false;

    // Condition 1: A new frame is starting for frames 1-9.
    // This is indicated by currentRoll being 0 after processRoll has run.
    if (currentFrame < 9 && currentRoll === 0) {
        fullPinReset = true;
    }

    // Condition 2: Handling the 10th frame logic.
    if (currentFrame === 9) {
        const frame10 = scoreData[9];
        const firstRollWasStrike = frame10.rolls[0] === 'X';
        const isSpareOnSecond = frame10.rolls[1] === '/';

        // Reset for the 2nd ball if the 1st was a strike.
        if (currentRoll === 1 && firstRollWasStrike) {
            fullPinReset = true;
        }
        // Reset for the 3rd ball if it was earned via a strike or spare.
        else if (currentRoll === 2 && (firstRollWasStrike || isSpareOnSecond)) {
            fullPinReset = true;
        }
    }

    // This handles the transition from frame 9 to 10. If the 9th frame was a strike,
    // currentRoll becomes 0 and currentFrame becomes 9. The next roll is the first
    // in the 10th, which needs a full rack.
    if (currentFrame === 9 && currentRoll === 0) {
        fullPinReset = true;
    }


    if (fullPinReset) {
        resetPins();
    } else {
        // This case only happens on the 2nd roll of an open frame (including the 10th).
        const fallenPins = getFallenPins();
        for (const pin of fallenPins) {
            pin.mesh.visible = false;
        }
        resetBall();
    }
}

function processRoll() {
    if (isGameOver) return;

    // First, update the fallen state of all pins based on the new logic
    const pins = dynamicObjects.filter(obj => obj.isPin);
    for (const pin of pins) {
        getPinContacts(pin); // This function now updates the pin's isFallen property
    }

    // Now, get the list of pins that are marked as fallen
    const fallenPins = getFallenPins();
    const fallenThisRoll = Math.max(0, fallenPins.length - pinsDownLastRoll);

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

    hudMesh.visible = true;
    scene.add(hudMesh);

    return hudMesh;
}

function drawPinHUD() {
    if (!pinHUD) return;

    const ctx = pinHUD.userData.context;
    const canvas = pinHUD.userData.canvas;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.0)';
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
        const pin = pins.find(p => p.pinId === index); // Find pin by its unique ID
        // The pin is standing if it exists and is NOT marked as fallen.
        const isStanding = pin && !pin.isFallen;

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 12, 0, 2 * Math.PI);
        ctx.fillStyle = isStanding ? 'white' : 'black';
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
    eventQueue = new RAPIER.EventQueue(true);
    world.integrationParameters.dt = 1/120;

    const urlParams = new URLSearchParams(window.location.search);
    const isTestMode = urlParams.has('test');

    if (isTestMode) {
        // In test mode, bypass AR and set up the scene directly
        sceneSetupInitiated = true;
        fY_floor = 0; // Assume flat ground for testing
        (async () => {
            await placeScene(fY_floor, loader, world, dynamicObjects);
            updateGameModeUI();
            // Expose functions for Playwright testing
            window.createConfirmationDialog = createConfirmationDialog;
            window.renderer = renderer;
            window.scene = scene;
            window.getBallContacts = getBallContacts;
            window.testModeReady = true; // Signal that the test environment is ready
        })();
    } else {
        // Standard AR mode initialization
        const arButton = ARButton.createButton(renderer, {
            requiredFeatures: ['local-floor', 'plane-detection']
        });
        document.body.appendChild(arButton);

        arButton.addEventListener('click', () => {
            if (audioManager && audioManager.audioContext.state === 'suspended') {
                audioManager.audioContext.resume();
            }
        });

        renderer.xr.addEventListener('sessionstart', () => {
            if (audioManager && audioManager.audioContext.state === 'suspended') {
                audioManager.audioContext.resume();
            }
            // Scene setup is handled in the animate loop for AR
        });
        renderer.xr.addEventListener('sessionend', cleanupScene);

        planes = new XRPlanes(renderer);
        // scene.add(planes); // Only add if needed for debugging
        // planes.visible = false;

        if (navigator.xr && navigator.xr.isSessionSupported) {
            navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
                if (supported && navigator.xr.requestSession) {
                    navigator.xr.requestSession('immersive-vr', {
                        optionalFeatures: ['local-floor', 'plane-detection'],
                    }).then((session) => {
                        renderer.xr.setSession(session);
                    });
                }
            });
        }
    }

    init();
}

function animate(timestamp, frame) {
    if (renderer.xr.isPresenting && !sceneSetupInitiated && frame) {
        if (planes.children.length > 0) {
            sceneSetupInitiated = true;

            let fY = 0;
            for (const planeMesh of planes.children) {
                fY = planeMesh.position.y < fY ? planeMesh.position.y : fY;
            }
            fY_floor = fY;

            (async () => {
                await placeScene(fY, loader, world, dynamicObjects);
                updateGameModeUI();

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
            })();
        }
    }

    // Step the physics world first
    if(world) world.step(eventQueue);

    // --- COLLISION EVENT HANDLING ---
    if (eventQueue) {
        eventQueue.drainCollisionEvents((handle1, handle2, started) => {
            const ball = dynamicObjects.find(obj => obj.isBall);
            if (!ball || !laneObject || !laneObject.collider) return;

            const ballColliderHandle = ball.collider.handle;
            const laneColliderHandle = laneObject.collider.handle;

            // Check if the collision involves the ball and the lane
            if (started) { // "started" is true for the beginning of a contact
                if ((handle1 === ballColliderHandle && handle2 === laneColliderHandle) ||
                    (handle1 === laneColliderHandle && handle2 === ballColliderHandle)) {
                      //console.log(ball.mesh.position.z);
                     if (ball.mesh.position.z>=-0.860) {
                      //console.log('nope');
                     } else {
                      //console.log('touch');
                      ballHasTouchedLane = true;
                     }
                    
                }
            }
            
            if (!started) return;

            const obj1 = colliderToObjectMap.get(handle1);
            const obj2 = colliderToObjectMap.get(handle2);
            if (!obj1 || !obj2) return;

            const isBall1 = obj1.isBall;
            const isPin1 = obj1.isPin;
            const isLane1 = obj1.name === 'lane';

            const isBall2 = obj2.isBall;
            const isPin2 = obj2.isPin;
            const isLane2 = obj2.name === 'lane';

            // Ball-Pin collision
            if ((isBall1 && isPin2) || (isBall2 && isPin1)) {
                const pin = isPin1 ? obj1 : obj2;
                if (audioManager && !pin.isFallen) {
                    audioManager.playPinHit();
                }
            }

            // Ball-Lane collision
            if ((isBall1 && isLane2) || (isBall2 && isLane1)) {
                if (audioManager) {
                    audioManager.playThump();
                }
            }
        });
    }

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

    // --- AUDIO HANDLING ---
    if (audioManager) {
        const ball = dynamicObjects.find(obj => obj.isBall);
        if (ball && !holdingController) {
            const ballContacts = getBallContacts();
            const isOnLane = ballContacts.includes('lane');
            const isInGutter = ballContacts.includes('gutter');
            const linvel = ball.body.linvel();
            const speed = new THREE.Vector3(linvel.x, linvel.y, linvel.z).length();

            if ((isOnLane || isInGutter) && speed > 0.2) {
                audioManager.startRollingSound();
                const rate = 0.5 + Math.min(speed / 8, 1.5);
                audioManager.setRollRate(rate);
            } else {
                audioManager.stopRollingSound();
            }
        } else if (audioManager) {
            audioManager.stopRollingSound();
        }
    }
    if (pinHUD && pinHUD.visible) {
        // Update pin states in real-time for the HUD before drawing it
        const pins = dynamicObjects.filter(obj => obj.isPin);
        for (const pin of pins) {
            getPinContacts(pin);
        }
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
                    }, 5000);
                }
            }
        }

        // --- SCORING LOGIC: Roll Completion Detection ---
        const ball = dynamicObjects.find(obj => obj.isBall);
        const ballContacts = getBallContacts();
        if (ball && gameMode === 'scoring' && !isGameOver) {
         //console.log(ball.mesh.position.z);
         //console.log(ball.mesh.position.z<-0.850);
         //console.log(ballHasTouchedLane);
          if (ballContacts.includes('ground') && !rollCompletionTimer) {
           if (!ballHasTouchedLane) {
            isBallThrown = false; // Reset the throw state.
            // And we do nothing else, as requested. The turn does not proceed.
           } 
          }
        }
        if (gameMode === 'scoring' && isBallThrown && !isGameOver) {

            if (ball) {
                const isSleeping = ball.body.isSleeping();
                //const ballLocation = getBallLocationState(); //old method
                //const isOutOfPlay = ballLocation === 'gutter' || ballLocation === 'ground';
               
                const isOutOfPlay = ballContacts.includes('gutter') || ballContacts.includes('ground');


                // If the ball has stopped or is out of play, and a timer isn't already running...
                if ((isSleeping || isOutOfPlay) && !rollCompletionTimer) {

                       // NEW LOGIC: If the ball is on the ground but never touched the lane, it's an invalid roll.

    // EXISTING LOGIC: If it was a valid roll (hit the gutter or touched the lane), end the turn.
    if (ballContacts.includes('gutter') || ballHasTouchedLane) {
                        // isBallThrown is intentionally kept true here.
                        // It will be reset inside endTurn() -> resetBall() after the timer.
                        rollCompletionTimer = setTimeout(() => {
                            endTurn();
                            rollCompletionTimer = null;
                        }, 5000); // 5-second timer
    } else {
                     console.log("doesn't happen?");
                     isBallThrown = false;
    }
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
                    //const ballLocation = getBallLocationState();
                    //const canAdjust = ballLocation !== 'lane';
                    const ballContacts = getBallContacts();
                    const canAdjust = !ballContacts.includes('lane');


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
                            }, 20000);
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
                                    { text: 'Yes', action: 'startNewGame' }
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

                                // Position the options menu above the lane, similar to the scoreboard
                                if (laneObject) {
                                    const lanePosition = laneObject.mesh.position;
                                    optionsMenu.position.set(lanePosition.x, lanePosition.y + 1.5, lanePosition.z - 2);
                                    if (scoreboard) {
                                        optionsMenu.quaternion.copy(scoreboard.quaternion);
                                    }
                                } else {
                                    // Fallback position if the lane doesn't exist yet
                                    optionsMenu.position.set(0, 1.5, -3);
                                }
                            }
                        }
                    } else if (controller.gamepad.buttons[12] && !controller.gamepad.buttons[12].pressed) {
                        menuButtonState = false;
                    }
                }

                // Handle Pin HUD toggle (either controller, thumbstick press is 3)
                if (controller.gamepad.buttons[3] && controller.gamepad.buttons[3].pressed && !hudButtonState[i]) {
                 //tipAllPins();
                    hudButtonState[i] = true;
                    if (pinHUD) {
                        pinHUD.visible = !pinHUD.visible;
                        if (pinHUD.visible && laneObject) {
                            const lanePosition = laneObject.mesh.position;
                            pinHUD.position.set(lanePosition.x, lanePosition.y + 1.5, lanePosition.z - 3);
                            if (scoreboard) {
                                pinHUD.quaternion.copy(scoreboard.quaternion);
                            }
                        }
                    }
                } else if (controller.gamepad.buttons[3] && !controller.gamepad.buttons[3].pressed) {
                    hudButtonState[i] = false;
                }
            }
        }
    }
}

async function placeScene(fY, loader, world, dynamicObjects) {
    // Load Lane Model
    const laneGltf = await loader.loadAsync('3d/bowling.glb');

        // Visual ground and Physics Ground
        const groundMesh = laneGltf.scene;

        // Create a fixed rigid body for the lane at the origin.
        // We will set its final position after creating all components.
        const laneBodyDesc = RAPIER.RigidBodyDesc.fixed();
        const laneBody = world.createRigidBody(laneBodyDesc);
        laneObject = { mesh: groundMesh, body: laneBody, name: 'lane' };

    if (showCollision) {
        laneCollisionVisualizer = new THREE.Group();
        scene.add(laneCollisionVisualizer);
    }

    let ballMesh;

    // Create colliders for the lane and gutter from the bowling.glb model
    groundMesh.traverse(child => {
        if (child.isMesh) {
            child.updateMatrixWorld(true); // Ensure world matrix is up-to-date
            const bodyPosition = new THREE.Vector3(laneBody.translation().x, laneBody.translation().y, laneBody.translation().z);

            if (child.name === 'lane') {
              //child.visible = false;
                // Create a box collider for the lane for more reliable physics
                const boundingBox = new THREE.Box3().setFromObject(child);
                const size = boundingBox.getSize(new THREE.Vector3());
                const center = boundingBox.getCenter(new THREE.Vector3());

                // The collider's position is relative to the rigid body. Since the body is at the origin,
                // the collider's translation is the mesh's world center.
                center.sub(bodyPosition);

                const cuboidDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
                    .setTranslation(center.x, center.y, center.z)
                    .setRestitution(0.0)
                    .setCollisionGroups(LANE_COLLISION_GROUP)
                    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
                cuboidDesc.userData = { name: 'lane' };
                const laneCollider = world.createCollider(cuboidDesc, laneBody);
                laneObject.collider = laneCollider;
                colliderToObjectMap.set(laneCollider.handle, laneObject);

                if (showCollision) {
                    const visualizerGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
                    const visualizerMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 });
                    const visualizerMesh = new THREE.Mesh(visualizerGeo, visualizerMat);
                    visualizerMesh.position.copy(center);
                    laneCollisionVisualizer.add(visualizerMesh);
                }

            } else if (child.name === 'gutter') {
                // Create a trimesh collider for the gutter to match its complex shape
                const originalVertices = child.geometry.attributes.position.array;
                const transformedVertices = new Float32Array(originalVertices.length);
                const tempVec = new THREE.Vector3();

                for (let i = 0; i < originalVertices.length; i += 3) {
                    tempVec.set(originalVertices[i], originalVertices[i+1], originalVertices[i+2]);
                    // Transform vertex to world space, then to the rigid body's local space
                    tempVec.applyMatrix4(child.matrixWorld);
                    tempVec.sub(bodyPosition);
                    transformedVertices[i] = tempVec.x;
                    transformedVertices[i+1] = tempVec.y;
                    transformedVertices[i+2] = tempVec.z;
                }

                const indices = child.geometry.index.array;
                const trimeshDesc = RAPIER.ColliderDesc.trimesh(transformedVertices, indices)
                    .setRestitution(0.0)
                    .setCollisionGroups(LANE_COLLISION_GROUP);
                trimeshDesc.userData = { name: 'gutter' };
                const gutterCollider = world.createCollider(trimeshDesc, laneBody);
                // The gutter is part of the lane body, but we map its specific collider
                colliderToObjectMap.set(gutterCollider.handle, { name: 'gutter' });

                if (showCollision) {
                    const visualizerGeo = new THREE.BufferGeometry();
                    visualizerGeo.setAttribute('position', new THREE.BufferAttribute(transformedVertices, 3));
                    visualizerGeo.setIndex(new THREE.BufferAttribute(indices, 1));
                    const visualizerMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 });
                    const visualizerMesh = new THREE.Mesh(visualizerGeo, visualizerMat);
                    // The vertices are already in the body's local space, so the mesh position is (0,0,0) relative to the group.
                    laneCollisionVisualizer.add(visualizerMesh);
                }
            } else if (child.name === 'ball') {
                ballMesh = child;
            } else if (child.name === 'pin') {
                pinModel = child;
                child.visible = false; // Hide all original pins from the scene
            } else {
                // Hide other meshes in the GLB
                child.visible = false;
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
    floorColliderDesc.userData = { name: 'ground' };
    const floorCollider = world.createCollider(floorColliderDesc, floorBody);
    colliderToObjectMap.set(floorCollider.handle, { name: 'ground' });

    // Apply initial floor offset from localStorage
    updateFloorAndLanePosition();

    // Create Bowling Ball
    // The ball is now loaded from the bowling.glb file.
    // We need to remove it from its original parent to treat it as a separate dynamic object.
    if (ballMesh && ballMesh.parent) {
        ballMesh.parent.remove(ballMesh);
    }
    const ballBox = new THREE.Box3().setFromObject(ballMesh);

    // Center the geometry
    const center = ballBox.getCenter(new THREE.Vector3());
    //if (ballMesh.isMesh) {
        //ballMesh.geometry.translate(-center.x, -center.y, -center.z);
    //}
    ballBox.setFromObject(ballMesh); // Recalculate the box after centering

    const ballSize = ballBox.getSize(new THREE.Vector3());
    const ballRadius = ballSize.x / 2;

    const ballInitialPosition = { x: 0, y: fY + 0.5, z: -1 };
    const ballBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(ballInitialPosition.x, ballInitialPosition.y, ballInitialPosition.z).setCcdEnabled(true);
    const ballBody = world.createRigidBody(ballBodyDesc);
    const ballColliderDesc = RAPIER.ColliderDesc.ball(ballRadius).setCollisionGroups(BALL_COLLISION_GROUP).setMass(1).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    ballColliderDesc.userData = { name: 'ball' };
    const ballCollider = world.createCollider(ballColliderDesc, ballBody);

    const ballObject = { mesh: ballMesh, body: ballBody, collider: ballCollider, initialPosition: ballInitialPosition, isBall: true, name: 'ball' };
    dynamicObjects.push(ballObject);
    colliderToObjectMap.set(ballCollider.handle, ballObject);
    scene.add(ballMesh);
    ballMesh.visible = true;

    // Create Bowling Pins
     //const pinGltf = await loader.loadAsync('3d/pin.glb');
     //pinModel = pinGltf.scene;
 
    // Create a new, perfect pin template that is both visually correct and physically stable.
    if (pinModel && pinModel.isMesh) {
        // 1. Clone the geometry to preserve UVs, normals, etc., for correct texturing.
        const correctedGeometry = pinModel.geometry.clone();

        // 2. Apply the mesh's world matrix to the cloned geometry's vertices to get their true positions.
        correctedGeometry.applyMatrix4(pinModel.matrixWorld);

        // 3. Calculate the true center of the transformed geometry.
        correctedGeometry.computeBoundingBox();
        const trueCenter = new THREE.Vector3();
        correctedGeometry.boundingBox.getCenter(trueCenter);

        // 4. Translate the geometry so its center is at the origin (0,0,0).
        correctedGeometry.translate(-trueCenter.x, -trueCenter.y, -trueCenter.z);

        // 5. The corrected geometry's vertices are now perfect for the physics engine.
        pinVertices = correctedGeometry.attributes.position.array;

        // 6. Create the new pin template mesh using the corrected geometry and original material.
        pinModel = new THREE.Mesh(correctedGeometry, pinModel.material.clone());

        // 7. Calculate height from the new, correct geometry for accurate spawning.
        pinModel.geometry.computeBoundingBox();
        pinHeight = pinModel.geometry.boundingBox.max.y - pinModel.geometry.boundingBox.min.y;
    }

    createPins(fY + floorOffset);
  
}

function getBallContacts() {
    // If the ball is being held, that's its primary state.
    if (holdingController) {
        return ['in-hand'];
    }
    const ball = dynamicObjects.find(obj => obj.isBall);
    if (!ball || !ball.collider) {
        return [];
    }

    const contactNames = new Set(); // Use a Set to avoid duplicates

    world.contactPairsWith(ball.collider, (otherCollider) => {
        const contactObject = colliderToObjectMap.get(otherCollider.handle);
        let name = null;

        if (contactObject && contactObject.name) {
            name = contactObject.name;
        } else if (otherCollider.userData && otherCollider.userData.name) {
            name = otherCollider.userData.name;
        }

        if (name) {
            // Group all pins under a single 'pin' name for simplicity
            if (name.startsWith('pin_')) {
                contactNames.add('pin');
            } else {
                contactNames.add(name);
            }
        }
    });

    return Array.from(contactNames);
}

function getPinContacts(pinObject) {
    if (!pinObject || !pinObject.collider) {
        return [];
    }

    const contactNames = new Set();

    world.contactPairsWith(pinObject.collider, (otherCollider) => {
        const contactObject = colliderToObjectMap.get(otherCollider.handle);
        let name = null;

        if (contactObject && contactObject.name) {
            name = contactObject.name;
        } else if (otherCollider.userData && otherCollider.userData.name) {
            name = otherCollider.userData.name;
        }

        if (name) {
            contactNames.add(name);
        }
    });

    const contacts = Array.from(contactNames);

    // Check orientation: 5 degrees from vertical is cos(5 * PI/180) which is about 0.9962
    const up = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().copy(pinObject.body.rotation());
    const pinUp = up.clone().applyQuaternion(quaternion);
    const isTippedOver = pinUp.y < 0.9962;

    // Check if pin center is below the lane surface (more reliable than contact detection for this)
    const laneSurfaceY = fY_floor + floorOffset;
    const position = pinObject.body.translation();
    const isBelowLane = position.y < laneSurfaceY;

    // Update pin state if it's not already fallen. Once fallen, it stays fallen.
    if (!pinObject.isFallen && (isTippedOver || isBelowLane)) {
        pinObject.isFallen = true;
    }

    return contacts;
}



function createPins(fY) {
    let pinIdCounter = 0;

    function createPin(x, z, id) {
        const pinMesh = pinModel.clone();
        // Spawn the pin with its center of mass raised by half its height, so its base rests on the floor.
        const initialPosition = { x: x, y: fY + (pinHeight / 2), z: z };
        const pinBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(initialPosition.x, initialPosition.y, initialPosition.z);
        const pinBody = world.createRigidBody(pinBodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.convexHull(pinVertices).setCollisionGroups(PINS_COLLISION_GROUP);
        colliderDesc.userData = { name: `pin_${id}` }; // Add user data for identification
        const collider = world.createCollider(colliderDesc, pinBody);

        const pinObject = {
            mesh: pinMesh,
            body: pinBody,
            collider: collider,
            initialPosition: initialPosition,
            isPin: true,
            pinId: id,
            name: `pin_${id}`,
            isFallen: false // Initialize isFallen state
        };

        dynamicObjects.push(pinObject);
        colliderToObjectMap.set(collider.handle, pinObject); // Map the collider handle to the object

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
    // This function now simply returns a list of pins that have been marked as fallen.
    // The logic for determining if a pin is fallen has been moved to getPinContacts().
    return dynamicObjects.filter(obj => obj.isPin && obj.isFallen);
}

function resetBall() {
    const ball = dynamicObjects.find(obj => obj.isBall);
    if (ball) {
        if (audioManager) {
            audioManager.stopRollingSound();
        }
        // If the ball was being held, release it
        if (holdingController) {
            holdingController = null;
        }

        // After a reset, the ball should float in place until grabbed.
        ball.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased);
        ball.collider.setCollisionGroups(BALL_COLLISION_GROUP);

        // Reset position to its initial spot, accounting for any floor offset changes
        const initialPos = ball.initialPosition;
        const resetY = fY_floor + floorOffset + (initialPos.y - fY_floor);
        ball.body.setTranslation({ x: initialPos.x, y: resetY, z: initialPos.z }, true);

        // Reset velocities
        ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);

        // Reset throw state
        isBallThrown = false;
        ballHasTouchedLane = false;
    }
}

function resetPins() {
    pinsDownLastRoll = 0;
    // The confirmation dialog is dismissed by the input handler that calls this.
    // No need to dismiss it here.
    if (pinsFallenResetTimer) {
        clearTimeout(pinsFallenResetTimer);
        pinsFallenResetTimer = null;
    }
    if (rollCompletionTimer) {
        clearTimeout(rollCompletionTimer);
        rollCompletionTimer = null;
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

    // Reset the ball's position
    resetBall();
}


function tipAllPins() {
    const pins = dynamicObjects.filter(obj => obj.isPin);
    if (pins.length === 0) return;
    for (const pin of pins) {
        if (pin.body) {
            // Apply a small, slightly randomized impulse to make them fall over.
            const impulse = {
                x: (Math.random() - 0.5) * 0.01,
                y: 0,
                z: (Math.random() - 0.5) * 0.01
            };
            // The second argument `true` wakes the rigid-body if it's sleeping.
            pin.body.applyImpulse(impulse, true);
        }
    }
}
 /*
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

*/
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
    titleMesh.position.z = 0.02; // Increased to prevent z-fighting with the panel
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

    // Position the dialog above the lane, similar to the scoreboard
    if (laneObject) {
        const lanePosition = laneObject.mesh.position;
        dialog.position.set(lanePosition.x, lanePosition.y + 1.5, lanePosition.z - 1);
        if (scoreboard) {
            dialog.quaternion.copy(scoreboard.quaternion);
        }
    } else {
        // Fallback position if the lane doesn't exist yet
        dialog.position.set(0, 1.5, -2);
    }

    return dialog;
}

function updateFloorAndLanePosition(yDelta = 0) {
    if (laneObject) {
        const newPos = laneObject.mesh.position.clone();
        newPos.y = fY_floor + floorOffset;
        setLanePosition(newPos);

        // Also update scoreboard and pin HUD positions if they are visible
        if (scoreboard && scoreboard.visible) {
            scoreboard.position.set(newPos.x, newPos.y + 2.0, newPos.z - 2);
        }
        if (pinHUD && pinHUD.visible) {
            pinHUD.position.set(newPos.x, newPos.y + 1.5, newPos.z - 3);
        }
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
    if (audioManager) {
        audioManager.stopRollingSound();
    }
    // Dismiss any active UI
    if (activeConfirmationDialog) {
        activeConfirmationDialog.userData.dismiss();
    }

    // Clear any pending timers
    if (pinsFallenResetTimer) {
        clearTimeout(pinsFallenResetTimer);
    }
    if (rollCompletionTimer) {
        clearTimeout(rollCompletionTimer);
        rollCompletionTimer = null;
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
    colliderToObjectMap.clear();
}

async function init() {
    audioManager = new AudioManager();
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

    /*
    function onSelectStart(event) {
        const controller = event.target;
        if (holdingController === null) {
            const ball = dynamicObjects.find(obj => obj.isBall);
            if (ball) {
                //const ballLocation = getBallLocationState();
                //if (gameMode === 'scoring' && isBallThrown && ballLocation === 'lane') {
                 const ballContacts = getBallContacts();
                 if (gameMode === 'scoring' && isBallThrown && ballContacts.includes('lane')) {
                    return; //can't grab ball in play
                }
                const linvel = ball.body.linvel();
                const isMoving = new THREE.Vector3(linvel.x, linvel.y, linvel.z).length() > 0.1;

                //const isBelowLane = ballLocation === 'gutter' || ballLocation === 'ground';
                const isBelowLane = ballContacts.includes('gutter') || ballContacts.includes('ground');

                if (!isMoving || isBelowLane) {
                    // In freeplay mode, picking up the ball should clear the fallen pins.
                    if (gameMode === 'freeplay') {
                        clearFallenPins();
                    }

                    // Set the collision group immediately to prevent collision on the next physics step.
                    ball.collider.setCollisionGroups(HELD_BALL_COLLISION_GROUP);
                    // Register the intent to hold, which will be processed in the animate loop after the next physics step.
                    controllerWantsToHold = controller;
                }
            }
        }
    }
*/

//when the ball has touched the lane and is on the ground. I can't pick up and no reset is called.

function onSelectStart(event) {
    const controller = event.target;
    if (holdingController === null) {
        const ball = dynamicObjects.find(obj => obj.isBall);
        if (ball) {
            const ballContacts = getBallContacts();
            // In scoring mode, if a ball has been thrown, it cannot be grabbed until the turn is over.
            // The isBallThrown flag is the definitive state for a turn in progress.
            if (gameMode === 'scoring' && ballHasTouchedLane) {
                return;
            }

            const linvel = ball.body.linvel();
            const isMoving = new THREE.Vector3(linvel.x, linvel.y, linvel.z).length() > 0.1;

            const isBelowLane = ballContacts.includes('gutter') || ballContacts.includes('ground');

            if (!isMoving || isBelowLane) {
                // In freeplay mode, picking up the ball should clear the fallen pins.
                if (gameMode === 'freeplay') {
                    clearFallenPins();
                }

                if (audioManager) {
                    audioManager.stopRollingSound();
                }
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
                ballHasTouchedLane = false; // Reset lane contact flag on throw
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