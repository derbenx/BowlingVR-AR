import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRPlanes } from 'three/addons/webxr/XRPlanes.js';

var myLine;
const grv=-9.8; //gravity
const mas=40; //max arrow speed
const deb=false; //rapier debug
let sty=0; //start and scoring height

const OFFSET_DISTANCE = 0.015;
let offsetDirection,LOCAL_LEFT;

/**
 * A class for creating and managing a visual scoreboard in a Three.js scene.
 * All calculation and state management is handled externally.
 */
class Scoreboard {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 2048; // High-resolution canvas for clarity
        this.canvas.height = 256;
        this.context = this.canvas.getContext('2d');

        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.encoding = THREE.sRGBEncoding;
        this.texture.anisotropy = 16;

        // Plane geometry is sized to match the new aspect ratio
        const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, side: THREE.DoubleSide });
        const geometry = new THREE.PlaneGeometry(4.2, 0.5);
        this.mesh = new THREE.Mesh(geometry, material);

        this.headers = ["#", "1", "2", "3", "4", "5", "6", "END", "7", "8", "9", "10", "11", "12", "END", "H", "G", "Dz", "R/T"];

        this.drawEmptyBoard(); // Draw the initial empty board
    }

    /**
     * Draws the static background, grid, and headers for the scoreboard.
     */
    drawEmptyBoard() {
        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Background
        ctx.fillStyle = '#003366';
        ctx.fillRect(0, 0, w, h);

        // Grid and Headers
        ctx.strokeStyle = 'white';
        ctx.fillStyle = 'white';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const cellWidth = w / this.headers.length;

        this.headers.forEach((header, i) => {
            const x = i * cellWidth;
            ctx.strokeRect(x, 0, cellWidth, h / 2); // Header boxes
            ctx.fillText(header, x + cellWidth / 2, h * 0.25);
            ctx.strokeRect(x, h / 2, cellWidth, h / 2); // Empty score boxes
        });

        this.texture.needsUpdate = true;
    }

    /**
     * Displays a complete game's data on the scoreboard.
     * @param {object} gameData - An object containing all data for one game.
     * Example: { gameNumber: 1, scores: ['X', '10', ...], end1Total: 55, ... }
     */
    displayGame(gameData) {
        this.drawEmptyBoard(); // Start with a clean slate

        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const cellWidth = w / this.headers.length;
        const scoreY = h * 0.75;

        ctx.fillStyle = 'white';
        ctx.font = '48px sans-serif';

        // --- Draw Game Number ---
        ctx.fillText(`#${gameData.gameNumber}`, cellWidth / 2, scoreY);

        // --- Draw Individual Arrow Scores ---
        const getCellIndex = (scoreIndex) => {
            if (scoreIndex < 6) return scoreIndex + 1;      // Scores 0-5  -> Cells 1-6
            if (scoreIndex < 12) return scoreIndex + 2; // Scores 6-11 -> Cells 8-13
            return -1;
        };

        gameData.scores.forEach((score, i) => {
            const cellIndex = getCellIndex(i);
            if (cellIndex !== -1) {
                const x = cellIndex * cellWidth + cellWidth / 2;
                ctx.fillText(score.toString(), x, scoreY);
            }
        });

        // --- Draw Totals ---
        const end1Cell = 7;
        const end2Cell = 14;
        const hCell = 15;
        const gCell = 16;
        const dozenCell = 17;
        const rtCell = 18;

        if (gameData.scores.length >= 6) {
            ctx.fillText(gameData.end1Total.toString(), end1Cell * cellWidth + cellWidth / 2, scoreY);
        }
        if (gameData.scores.length >= 12) {
            ctx.fillText(gameData.end2Total.toString(), end2Cell * cellWidth + cellWidth / 2, scoreY);
            ctx.fillText(gameData.dozenTotal.toString(), dozenCell * cellWidth + cellWidth / 2, scoreY);
            ctx.fillText(gameData.runningTotal.toString(), rtCell * cellWidth + cellWidth / 2, scoreY);
        }

        // Hits and Golds are updated continuously
        ctx.fillText(gameData.hits.toString(), hCell * cellWidth + cellWidth / 2, scoreY);
        ctx.fillText(gameData.golds.toString(), gCell * cellWidth + cellWidth / 2, scoreY);

        this.texture.needsUpdate = true;
    }

    /**
     * Resets the scoreboard to its initial empty state.
     */
    reset() {
        this.drawEmptyBoard();
    }

    getMesh() {
        return this.mesh;
    }
}

/**
 * A class for creating and managing a visual in-VR menu.
 */
class BowHUD {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 512; // A good resolution for clarity
        this.canvas.height = 300; // Increased height for the new field
        this.context = this.canvas.getContext('2d');

        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.encoding = THREE.sRGBEncoding;
        this.texture.anisotropy = 16;

        const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true });
        // Aspect ratio is 512:300, so the plane should be e.g., 0.4 x 0.234
        const geometry = new THREE.PlaneGeometry(0.4, 0.234);
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.visible = false; // Initially hidden

        this.clear(); // Draw the initial empty HUD
    }

    clear() {
        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(0, 20, 40, 0.7)'; // Semi-transparent dark blue
        ctx.fillRect(0, 0, w, h);

        this.texture.needsUpdate = true;
    }

    update(data) {
        this.clear();
        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.fillStyle = 'white';
        ctx.font = 'bold 32px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        // --- Scores ---
        const scoresText = data.scores.join(' | ');
        ctx.fillText(`Scores: ${scoresText}`, 15, 15);


        if (data.lastArrow) {
            const arrowData = data.lastArrow;
            ctx.font = '28px sans-serif';

            // --- Speed ---
            const speed = arrowData.speed.toFixed(2);
            const topSpeed = arrowData.topSpeed.toFixed(2);
            ctx.fillText(`Speed: ${speed} m/s (Top: ${topSpeed})`, 15, 65);

            // --- Distance ---
            ctx.fillStyle = arrowData.isMoving ? 'lime' : 'red';
            const distance = arrowData.distance.toFixed(2);
            ctx.fillText(`Distance: ${distance} m`, 15, 110);

            // --- Altitude ---
            ctx.fillStyle = 'white';
            const altitude = arrowData.altitude.toFixed(2);
            const maxAltitude = arrowData.maxAltitude.toFixed(2);
            ctx.fillText(`Altitude: ${altitude} m (Max: ${maxAltitude})`, 15, 155);

            // --- Angle ---
            const angle = arrowData.angle.toFixed(1);
            ctx.fillText(`Angle: ${angle}°`, 15, 200);
        }


        this.texture.needsUpdate = true;
    }

    getMesh() {
        return this.mesh;
    }
}

class Menu {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 512;
        this.canvas.height = 1024;
        this.context = this.canvas.getContext('2d');

        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.encoding = THREE.sRGBEncoding;
        this.texture.anisotropy = 16;

        const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, side: THREE.DoubleSide });
        const geometry = new THREE.PlaneGeometry(0.5, 1);
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.visible = false;
    }

    draw(menuNode, highlightedIndex) {
        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const options = (typeof menuNode.getOptions === 'function' ? menuNode.getOptions() : menuNode.options).map(opt => opt.name);

        // Clear and draw background
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(0, 51, 102, 0.8)';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 5;
        ctx.strokeRect(0, 0, w, h);

        // Title
        ctx.font = 'bold 50px sans-serif';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText(menuNode.title, w / 2, 70);

        // Options
        ctx.font = 'bold 60px sans-serif';
        ctx.textBaseline = 'middle';
        const lineHeight = (h - 150) / (options.length);

        options.forEach((option, i) => {
            const y = 150 + (lineHeight * i) + (lineHeight / 2);
            ctx.fillStyle = (i === highlightedIndex) ? '#FFD700' : 'white';
            ctx.fillText(option, w / 2, y);
        });

        this.texture.needsUpdate = true;
    }

    drawHelp(helpNode) {
        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Clear and draw background
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(0, 51, 102, 0.8)';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 5;
        ctx.strokeRect(0, 0, w, h);

        // Title
        ctx.font = 'bold 50px sans-serif';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText(helpNode.title, w / 2, 60);

        // Help Text
        ctx.font = '36px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const lineHeight = 45;
        helpNode.lines.forEach((line, i) => {
            ctx.fillText(line, 40, 120 + i * lineHeight);
        });

        this.texture.needsUpdate = true;
    }

    show() {
        this.mesh.visible = true;
    }

    hide() {
        this.mesh.visible = false;
    }

    getMesh() {
        return this.mesh;
    }
}

class RapierDebugRenderer {
  mesh
  world
  enabled = deb

  constructor(scene, world) {
    this.world = world
    this.mesh = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, vertexColors: true }))
    this.mesh.frustumCulled = false
    scene.add(this.mesh)
  }

  update() {
    if (this.enabled) {
      const { vertices, colors } = this.world.debugRender()
      this.mesh.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
      this.mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4))
      this.mesh.visible = true
    } else {
      this.mesh.visible = false
    }
  }
}

function moveTargetToDistance(distance) {
    if (!target || !target.userData.body) return;

    const newPosition = new THREE.Vector3(0, initialTargetPosition ? initialTargetPosition.y : sty, -distance);

    // Update the stored shooting position and the global initial position
    target.userData.shootingPosition.copy(newPosition);
    if(initialTargetPosition) initialTargetPosition.copy(newPosition);

    // Immediately move the visual group and sync the physics body
    target.position.copy(newPosition);
    target.userData.body.setNextKinematicTranslation(newPosition, true);
    target.userData.body.setNextKinematicRotation(target.quaternion, true);
}


// --- Three.js and Global Variables ---
let camera, scene, renderer;
let loader;
let planes;
let floorBody = null;

// --- Physics ---
let world;
let loadedGLTF = null;
let previewModel = null;
const gravity = { x: 0.0, y: grv, z: 0.0 };

// --- Collision Groups ---
const GROUP_ARROW = 1 << 0;
const GROUP_TARGET = 1 << 1;
const GROUP_FLOOR = 1 << 2;

const ARROW_GROUP_FILTER = (GROUP_ARROW << 16) | (GROUP_TARGET | GROUP_FLOOR);
const TARGET_GROUP_FILTER = (GROUP_TARGET << 16) | GROUP_ARROW;
const FLOOR_GROUP_FILTER = (GROUP_FLOOR << 16) | GROUP_ARROW;

// --- Game Objects ---
let bow, target, bowstring;
let arrowTemplate;
let arrowObject = null;
let firedArrows = []; // Master list of all arrows shot in the current 12-shot game
let lastFiredArrow = null;
let currentRoundArrows = []; // The 3 arrows being processed after a round

// --- Game Data and State ---
let gameHistory = [];
let currentGame = null;
let runningTotal = 0;
let viewingGameIndex = -1; // -1 indicates viewing the current game. 0+ for history.

// --- HUD ---
let bowHUD;
let hudScores = [];
let isHudVisible = true;

/*
let isArrowCamVisible = false;
let arrowCamera;
let arrowCamViewer;
let arrowCamRenderTarget;
*/

// --- Menu ---
let menu;
let isMenuOpen = false;
const targetDistances = [3, 6, 9, 15, 20, 25, 30, 40, 50];
let selectedMenuIndex = 0;

let menuTree; // Will be defined in placeScene
let currentMenuNode = null;

// --- Target Motion State ---
let targetMotionState = 'Still'; // Still, Left & Right, Up & Down, Random
let targetMotionSpeed = 'Medium'; // Slow, Medium, Fast, Random
let initialTargetPosition = null;
let motionTheta = 0;
let motionPhi = Math.PI / 2;
let isScoreboardVisible = true;
let isAimAssistVisible = true;
let scoreboardStateBeforeInspection = true;
let qixMotionDirection = new THREE.Vector3();
let qixMotionDuration = 0;
let qixMotionStartTime = 0;
let lastTimestamp = 0;
let randomMotionStartPosition = new THREE.Vector3();

// --- Game State Machine ---
const GameState = {
    SHOOTING: 'shooting',
    PROCESSING_SCORE: 'processing_score',
    INSPECTING: 'inspecting',
    RESETTING: 'resetting'
};
let gameState = GameState.SHOOTING;

// --- Scoreboard ---
let scoreboard;
let eventQueue;
let colliderToScoreMap;

// --- Audio ---
let audioCtx = null;
// --- Controller and State ---
let rapierDebugRenderer;
let bowController = null;
let arrowController = null;
let sceneSetupInitiated = false;
let aButtonPressed = [false, false]; // To track 'A' button state for each controller
let bButtonPressed = [false, false]; // To track 'B' button state for each controller
let thumbstickPressed = [false, false]; // To track thumbstick button state
let joystickMoved = [false, false]; // To prevent rapid-fire history navigation
let button12Pressed = [false, false]; // To track button 12 state for each controller

function showPreviewModel() {
    if (loadedGLTF) {
        previewModel = loadedGLTF.scene.clone();
        previewModel.position.set(0, 1.4, -1);
        scene.add(previewModel);
    }
}

function cleanupPreviewModel() {
    if (previewModel) {
        scene.remove(previewModel);
        previewModel = null;
    }
}

async function init() {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 2);
    camera.lookAt(0, 1.6, 0);


    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0, 2, -5);
    scene.add(directionalLight);

    loader = new GLTFLoader();
    loader.load('3d/archery.glb', (gltf) => {
        loadedGLTF = gltf;
        showPreviewModel();
    });


    await RAPIER.init();
    world = new RAPIER.World(gravity);
    world.integrationParameters.dt = 1 / 120; // Use a smaller timestep for more accurate physics
    eventQueue = new RAPIER.EventQueue(true);
    colliderToScoreMap = new Map();
    rapierDebugRenderer = new RapierDebugRenderer(scene, world);

    const arButton = ARButton.createButton(renderer, { requiredFeatures: ['local-floor', 'plane-detection'] });
    document.body.appendChild(arButton);
    planes = new XRPlanes(renderer);
    scene.add(planes);

    setupControllers();

    // Create and position the scoreboard
    scoreboard = new Scoreboard();
    const scoreboardMesh = scoreboard.getMesh();
    // Position it in a fixed location in the world.
    scoreboardMesh.position.set(0, 1.6, -2.5);
    scene.add(scoreboardMesh);

    // Create and add the menu
    menu = new Menu();
    scene.add(menu.getMesh());

    // Create the Bow HUD
    bowHUD = new BowHUD();
    scene.add(bowHUD.getMesh());
/*
    // --- Arrow Camera Setup ---
    // The size of the render target determines the resolution of the arrow cam view.
    arrowCamRenderTarget = new THREE.WebGLRenderTarget(512, 512, {
        encoding: THREE.sRGBEncoding
    });

    // Create the second camera for the arrow.
    arrowCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    scene.add(arrowCamera);

    // Create the viewer plane.
    const viewerGeometry = new THREE.PlaneGeometry(0.3, 0.3);
    const viewerMaterial = new THREE.MeshBasicMaterial({ map: arrowCamRenderTarget.texture });
    arrowCamViewer = new THREE.Mesh(viewerGeometry, viewerMaterial);
    arrowCamViewer.visible = false;
    scene.add(arrowCamViewer);
*/

    loadSettings();
    startNewGame();


    renderer.xr.addEventListener('sessionend', cleanupScene);
    window.addEventListener('resize', onWindowResize);
    renderer.setAnimationLoop(animate);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function setupControllers() {
    const controllerModelFactory = new XRControllerModelFactory();
    for (let i = 0; i < 2; i++) {
        const controller = renderer.xr.getController(i);
        controller.userData.id = i;
        scene.add(controller);

        const grip = renderer.xr.getControllerGrip(i);
        grip.add(controllerModelFactory.createControllerModel(grip));
        scene.add(grip);

        controller.addEventListener('connected', (event) => {
            controller.gamepad = event.data.gamepad;
        });

        controller.addEventListener('selectstart', onSelectStart);
        controller.addEventListener('selectend', onSelectEnd);
    }
}

function onSelectStart(event) {
    const controller = event.target;

    // --- AudioContext Initialization ---
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    // --- Menu Selection ---
    if (isMenuOpen) {
        if (!currentMenuNode) return;

        // If on an info screen like Help, any button press closes it.
        if (currentMenuNode.type === 'info') {
            currentMenuNode = menuTree.submenus[currentMenuNode.parent];
            selectedMenuIndex = 0;
            menu.draw(currentMenuNode, selectedMenuIndex);
            return;
        }

        const options = typeof currentMenuNode.getOptions === 'function' ? currentMenuNode.getOptions() : currentMenuNode.options;
        const selectedOption = options[selectedMenuIndex];
        if (selectedOption) {
            if (selectedOption.submenu) {
                const submenuName = selectedOption.submenu;
                currentMenuNode = menuTree.submenus[submenuName];

                // Pre-select the index based on the current setting
                switch (submenuName) {
                    case 'range':
                        // Fallback to initial position if target is not yet created
                        const currentDistance = target ? -target.userData.shootingPosition.z : targetDistances[0];
                        const distanceIndex = targetDistances.indexOf(currentDistance);
                        selectedMenuIndex = (distanceIndex !== -1) ? distanceIndex : 0;
                        break;
                    case 'motion':
                        const motionOptions = currentMenuNode.options.map(o => o.name);
                        const motionIndex = motionOptions.indexOf(targetMotionState);
                        selectedMenuIndex = (motionIndex !== -1) ? motionIndex : 0;
                        break;
                    case 'speed':
                        const speedOptions = currentMenuNode.options.map(o => o.name);
                        const speedIndex = speedOptions.indexOf(targetMotionSpeed);
                        selectedMenuIndex = (speedIndex !== -1) ? speedIndex : 0;
                        break;
                    case 'scoreboard':
                        selectedMenuIndex = isScoreboardVisible ? 0 : 1;
                        break;
                    case 'aim':
                        selectedMenuIndex = isAimAssistVisible ? 0 : 1;
                        break;
                    case 'hud':
                        selectedMenuIndex = isHudVisible ? 0 : 1;
                        break;
                    default:
                        selectedMenuIndex = 0; // Default for menus without a setting to sync
                        break;
                }

                if (currentMenuNode.type === 'info') {
                    menu.drawHelp(currentMenuNode);
                } else {
                    menu.draw(currentMenuNode, selectedMenuIndex);
                }
            } else if (selectedOption.action) {
                selectedOption.action();
                isMenuOpen = false;
                menu.hide();
            }
        }
        return; // Prevent other actions
    }

/*
    // --- Arrow Cam Deactivation ---
    if (arrowCamViewer) {
        arrowCamViewer.visible = false;
    }
*/

    // --- Arrow Spawning ---
    // Conditions: No arrow currently held, not holding the bow with this hand.
    if (!arrowObject && controller !== bowController) {
        // Explicitly check if the controller is the bow controller
        if (bowController && controller.userData.id === bowController.userData.id) {
            return;
        }
        const otherController = renderer.xr.getController(1 - controller.userData.id);
        if (otherController) {
            const distance = controller.position.distanceTo(otherController.position);

            // Spawn only if hands are far enough apart
            if (distance > 0.5) {
                if (!arrowTemplate) return;

                const newArrowMesh = arrowTemplate.clone();
                newArrowMesh.visible = true;
                newArrowMesh.position.z = .3;
                //console.log(newArrowMesh);

                // Create physics body
                const arrowBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
                const body = world.createRigidBody(arrowBodyDesc);
                const vertices = arrowTemplate.geometry.attributes.position.array;
                const indices = arrowTemplate.geometry.index.array;
                const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices)
                    .setMass(0.1)
                    .setCollisionGroups(ARROW_GROUP_FILTER)
                    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
                const collider = world.createCollider(colliderDesc, body);

                // Create the arrow object with new state
                arrowObject = {
                    mesh: newArrowMesh,
                    body: body,
                    isNocked: false, // New state for nocking
                    hasScored: false,
                    score: 'M',
                    // HUD-specific data
                    speed: 0,
                    topSpeed: 0,
                    distance: 0,
                    altitude: 0,
                    maxAltitude: 0,
                    isMoving: false,
                    angle: 0
                };
                collider.userData = { type: 'arrow', arrow: arrowObject };

                // Parent the arrow to the controller that spawned it
                controller.add(newArrowMesh);
                arrowController = controller;
            }
        }
    }

    // If viewing history, snap back to the current game upon drawing an arrow
    if (viewingGameIndex !== -1) {
        viewingGameIndex = -1;
        scoreboard.displayGame(currentGame);
        //console.log("Switched back to current game due to drawing arrow.");
    }
}

function onSelectEnd(event) {
    const controller = event.target;
    if (controller === arrowController && arrowObject) {
        if (arrowObject.isNocked) {
            // If arrow is nocked, fire it
            shootArrow();
        } else {
            // If not nocked, cancel the arrow
            //console.log("Arrow grab released without nocking. Cancelling arrow.");
            if (arrowObject.mesh) arrowObject.mesh.removeFromParent(); // Remove from controller
            if (arrowObject.body) world.removeRigidBody(arrowObject.body);
            arrowObject = null;
            arrowController = null;
        }
    }
}

async function placeScene(floorY) {
    if (!loadedGLTF) {
        console.error("GLTF model not loaded yet!");
        return;
    }
    cleanupPreviewModel();


    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
    const points = [new THREE.Vector3(), new THREE.Vector3()];
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
    myLine = new THREE.Line(lineGeometry, lineMaterial);
    myLine.visible = false;
    scene.add(myLine);

    const gltf = loadedGLTF;

    if (floorBody) world.removeRigidBody(floorBody);
    const floorBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, floorY, 0);
    floorBody = world.createRigidBody(floorBodyDesc);
    const floorColliderDesc = RAPIER.ColliderDesc.cuboid(100, 0.1, 100).setCollisionGroups(FLOOR_GROUP_FILTER);
    const floorCollider = world.createCollider(floorColliderDesc, floorBody);
    floorCollider.userData = { type: 'floor' };

    // --- Menu Tree Definition ---
    const getMainMenuOptions = () => {
        const options = [
            { name: "Range", submenu: "range" },
            { name: "Motion", submenu: "motion" }
        ];
        //if (targetMotionState !== 'Still') {
        options.push({ name: "Speed", submenu: "speed" });
        //}
        options.push({ name: "Scoreboard", submenu: "scoreboard" });
        options.push({ name: "Aim Line", submenu: "aim" });
        options.push({ name: "HUD", submenu: "hud" });
        //options.push({ name: "Arrow Cam", submenu: "arrowCam" });
        options.push({ name: "Help", submenu: "help" });
        return options;
    };

/*
            arrowCam: {
                title: "Arrow Cam",
                parent: "root",
                options: [
                    { name: "On", action: () => { isArrowCamVisible = true; saveSettings(); } },
                    { name: "Off", action: () => { isArrowCamVisible = false; saveSettings(); } }
                ]
            },
*/

    menuTree = {
        title: "Main Menu",
        getOptions: getMainMenuOptions, // Use a function to generate options
        submenus: {
            hud: {
                title: "HUD",
                parent: "root",
                options: [
                    { name: "On", action: () => { isHudVisible = true; saveSettings(); } },
                    { name: "Off", action: () => { isHudVisible = false; saveSettings(); } }
                ]
            },
            scoreboard: {
                title: "Scoreboard",
                parent: "root",
                options: [
                    { name: "Show", action: () => { isScoreboardVisible = true; saveSettings(); } },
                    { name: "Hide", action: () => { isScoreboardVisible = false; saveSettings(); } }
                ]
            },
            aim: {
                title: "Sight",
                parent: "root",
                options: [
                    { name: "On", action: () => { isAimAssistVisible = true; saveSettings(); } },
                    { name: "Off", action: () => { isAimAssistVisible = false; saveSettings(); } }
                ]
            },
            help: {
                title: "Help",
                parent: "root",
                type: "info", // Special type for the drawHelp method
                lines: [
                    "CONTROLS:",
                    "Grip: Hold Bow",
                    "Trigger: Spawn/Shoot Arrow",
                    "A Button: Confirm Menu",
                    "B Button: Cancel/Back Menu",
                    "Joystick: Navigate Menu",
                    "Stick: Toggle Scoreboard",
                    "",
                    "SHOOTING PROCEDURE:",
                    "1. Hands apart.",
                    "2. Hold Grip for bow.",
                    "3. Hold Trigger for arrow.",
                    "4. Hands together to nock.",
                    "5. Release Trigger to fire."
                ]
            },
            range: {
                title: "Set Range",
                parent: "root",
                options: targetDistances.map(d => ({
                    name: `${d} meters`,
                    action: () => moveTargetToDistance(d)
                }))
            },
            motion: {
                title: "Set Motion",
                parent: "root",
                options: [
                    { name: "Still", action: () => { targetMotionState = 'Still'; if(target && initialTargetPosition) target.position.copy(initialTargetPosition); } },
                    { name: "Left & Right", action: () => { targetMotionState = 'Left & Right'; if(target && initialTargetPosition) target.position.copy(initialTargetPosition); } },
                    { name: "Up & Down", action: () => { targetMotionState = 'Up & Down'; if(target && initialTargetPosition) target.position.copy(initialTargetPosition); } },
                    { name: "Random Seated", action: () => {
                        targetMotionState = 'Random Seated';
                        if(target && initialTargetPosition) {
                            target.position.copy(initialTargetPosition);
                            qixMotionStartTime = 0;
                            lastTimestamp = 0;
                        }
                    } },
                    { name: "Random Standing", action: () => {
                        targetMotionState = 'Random Standing';
                        if(target && initialTargetPosition) {
                            target.position.copy(initialTargetPosition);
                            qixMotionStartTime = 0;
                            lastTimestamp = 0;
                        }
                    } }
                ]
            },
            speed: {
                title: "Set Speed",
                parent: "root",
                options: [
                    { name: "Slow", action: () => { targetMotionSpeed = 'Slow'; } },
                    { name: "Medium", action: () => { targetMotionSpeed = 'Medium'; } },
                    { name: "Fast", action: () => { targetMotionSpeed = 'Fast'; } },
                    { name: "Faster", action: () => { targetMotionSpeed = 'Faster'; } },
                    { name: "Random", action: () => { targetMotionSpeed = 'Random'; } }
                ]
            }
        }
    };
    // Add a 'root' reference for easier navigation
    menuTree.submenus.root = menuTree;


    const initialDistance = targetDistances[0]; // Default to the first distance
    target = new THREE.Group();
    target.userData.shootingPosition = new THREE.Vector3(0, sty, -initialDistance);
    target.userData.scoringPosition = new THREE.Vector3(0, sty, -1.2);
    target.userData.inScoringPosition = false;

    // Create a single, kinematic rigid body for the entire target.
    // It starts at the origin; its position will be set later.
    const targetBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
    const targetBody = world.createRigidBody(targetBodyDesc);
    target.userData.body = targetBody; // Store the single body.
    const bodyPosition = new THREE.Vector3().copy(targetBody.translation());


    gltf.scene.traverse(child => {
        if (child.isMesh && !isNaN(parseInt(child.name))) { // Find meshes with numeric names (target rings)
            const visualMesh = child.clone();
            target.add(visualMesh); // Add visual mesh to the target group

            // Ensure the child's world matrix is up-to-date
            visualMesh.updateMatrixWorld(true);

            // Get vertices and indices from the mesh's geometry
            const vertices = visualMesh.geometry.attributes.position.array;
            const indices = visualMesh.geometry.index.array;
            const transformedVertices = new Float32Array(vertices.length);
            const tempVec = new THREE.Vector3();

            // The key is to transform the vertices into the *local space* of the parent rigid body.
            for (let i = 0; i < vertices.length; i += 3) {
                tempVec.set(vertices[i], vertices[i+1], vertices[i+2]);
                // Transform the vertex from the mesh's local space to world space...
                tempVec.applyMatrix4(visualMesh.matrixWorld);
                // ...and then subtract the parent body's world position to get the vertex's local position relative to the body.
                tempVec.sub(bodyPosition);
                transformedVertices[i] = tempVec.x;
                transformedVertices[i+1] = tempVec.y;
                transformedVertices[i+2] = tempVec.z;
            }

            // Create a trimesh collider with the correctly transformed vertices and add it to the single targetBody
            const colliderDesc = RAPIER.ColliderDesc.trimesh(transformedVertices, indices)
                .setCollisionGroups(TARGET_GROUP_FILTER)
                .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

            const collider = world.createCollider(colliderDesc, targetBody);

            // Map the collider to its score value
            let scoreValue = child.name === '11' ? 'X' : child.name;
            colliderToScoreMap.set(collider.handle, scoreValue);
            collider.userData = { type: 'target' };
        }
    });
console.log(target);

    scene.add(target);
    moveTargetToDistance(initialDistance);

    // Store the initial position after it's set
    initialTargetPosition = target.position.clone();


    bow = gltf.scene.getObjectByName('bow');
    if (bow) {
        scene.add(bow);
        bow.visible = false;
        //bow.geometry.computeBoundingBox();
        const bowBox = bow.geometry.boundingBox;
        //const bowBox = new THREE.Box3().setFromObject(bow);
        const bowSize = bowBox.getSize(new THREE.Vector3());
        const bowCenter = bowBox.getCenter(new THREE.Vector3());

        //const bowCenterX = bowBox.getCenter(new THREE.Vector3()).x;
        const backZ = bowBox.min.z;
        bow.userData.top = new THREE.Vector3(bowCenter.x, bowBox.max.y, backZ);
        bow.userData.bottom = new THREE.Vector3(bowCenter.x, bowBox.min.y, backZ);

        const stringMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
        const points = new Float32Array(3 * 3);
        const stringGeometry = new THREE.BufferGeometry();
        stringGeometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
        bowstring = new THREE.Line(stringGeometry, stringMaterial);
        scene.add(bowstring);
        bowstring.visible = false;
    }

    const arrowMesh = gltf.scene.getObjectByName('arrow');
    if (arrowMesh) {
        arrowTemplate = arrowMesh;
        arrowTemplate.geometry.computeBoundingBox();
        const arrowBox = arrowTemplate.geometry.boundingBox;
        const arrowSize = new THREE.Vector3();
        arrowBox.getSize(arrowSize);

        const maxDim = Math.max(arrowSize.x, arrowSize.y, arrowSize.z);
        arrowTemplate.userData.length = maxDim;

        const localForward = new THREE.Vector3();
        const localNock = new THREE.Vector3();
        const center = arrowBox.getCenter(new THREE.Vector3());

        // Determine the longest axis and assume the tip is at the negative end and nock at the positive end.
        const localTip = new THREE.Vector3();
        if (arrowSize.x === maxDim) {
            localForward.set(-1, 0, 0);
            localNock.set(arrowBox.max.x, center.y, center.z);
            localTip.set(arrowBox.min.x, center.y, center.z);
        } else if (arrowSize.y === maxDim) {
            localForward.set(0, -1, 0);
            localNock.set(center.x, arrowBox.max.y, center.z);
            localTip.set(center.x, arrowBox.min.y, center.z);
        } else {
            localForward.set(0, 0, -1);
            localNock.set(center.x, center.y, arrowBox.max.z);
            localTip.set(center.x, center.y, arrowBox.min.z);
        }

        arrowTemplate.userData.forward = localForward;
        arrowTemplate.userData.nock = localNock;
        arrowTemplate.userData.tip = localTip;

        arrowTemplate.visible = false;
    }
}

function shootArrow() {
    if (!bowController || !arrowController || !arrowObject || !arrowObject.body) return;
    if (gameState === GameState.PROCESSING_SCORE) { return; }
    if (gameState === GameState.INSPECTING) { return; }

    const { mesh, body } = arrowObject;

    // Ensure the body is dynamic and awake before applying forces.
    body.setBodyType(RAPIER.RigidBodyType.Dynamic);
    body.setTranslation(mesh.position, true);
    body.setRotation(mesh.quaternion, true);
    body.wakeUp(); // Ensure the body is active in the simulation

    const arrowHand = renderer.xr.getController(arrowController.userData.id);
    const bowHand = renderer.xr.getController(bowController.userData.id);

    const worldLeftDirection = LOCAL_LEFT.clone().applyQuaternion(bowHand.quaternion);
    const arrowRestPosition = new THREE.Vector3()
            .copy(bowHand.position)
            .add(worldLeftDirection.multiplyScalar(OFFSET_DISTANCE));

    const worldDirection = new THREE.Vector3().subVectors(arrowRestPosition, arrowHand.position).normalize();
    //offsetDirection
    //const drawDistance = Math.min(arrowHand.position.distanceTo(bowHand.position), arrowTemplate.userData.length);
    //const drawRatio = drawDistance / arrowTemplate.userData.length;

        // To ensure the arrow flies straight, get its forward direction from its rotation.
    //const worldDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(mesh.quaternion);

    // The draw distance is still based on the hands for calculating power.
    const drawDistance = arrowHand.position.distanceTo(bowHand.position);
    const drawRatio = Math.min(drawDistance, arrowTemplate.userData.length) / arrowTemplate.userData.length;

    const maxSpeed = mas;
    const speed = drawRatio * maxSpeed;

    body.setLinvel(worldDirection.multiplyScalar(speed), true);

    playTwangSound();

    arrowObject.isMoving = true;
    firedArrows.push(arrowObject);
    lastFiredArrow = arrowObject;

    // State transition is now handled in the animate loop once all arrows have landed.

    arrowObject = null;
    arrowController = null;
}

function cleanupScene() {
    if (target) {
        // Remove the single physics body associated with the target
        if (target.userData.body) world.removeRigidBody(target.userData.body);
        scene.remove(target);
    }
    if (bow) scene.remove(bow);
    if (bowstring) scene.remove(bowstring);

    if (arrowObject) {
        if (arrowObject.mesh) scene.remove(arrowObject.mesh);
        if (arrowObject.body) world.removeRigidBody(arrowObject.body);
    }
    firedArrows.forEach(obj => {
        if (obj.mesh) scene.remove(obj.mesh);
        if (obj.body) world.removeRigidBody(obj.body);
    });
    currentRoundArrows.forEach(obj => {
        if (obj.mesh) scene.remove(obj.mesh);
        if (obj.body) world.removeRigidBody(obj.body);
    });

    if (floorBody) world.removeRigidBody(floorBody);

    target = bow = bowstring = arrowTemplate = arrowObject = bowController = arrowController = floorBody = null;

    // Reset game state
    gameHistory = [];
    runningTotal = 0;
    startNewGame();

    sceneSetupInitiated = false;
    showPreviewModel();
}

function animate(timestamp, frame) {
    if (renderer.xr.isPresenting && !sceneSetupInitiated && frame) {
        if (planes.children.length > 0) {
            let floorY = 0;
            planes.children.forEach(plane => { floorY = Math.min(floorY, plane.position.y); });
            placeScene(floorY);
            sceneSetupInitiated = true;
            planes.visible = false;
        }
    }

    if (world) world.step(eventQueue);

    const collisions = new Map();

    eventQueue.drainCollisionEvents((handle1, handle2, started) => {
        if (!started) return;

        const collider1 = world.getCollider(handle1);
        const collider2 = world.getCollider(handle2);

        let arrow, otherCollider, arrowHandle;
        if (collider1?.userData?.type === 'arrow') {
            arrow = collider1.userData.arrow;
            arrowHandle = handle1;
            otherCollider = collider2;
        } else if (collider2?.userData?.type === 'arrow') {
            arrow = collider2.userData.arrow;
            arrowHandle = handle2;
            otherCollider = collider1;
        } else {
            return;
        }

        if (arrow.hasScored) return;

        if (!collisions.has(arrowHandle)) {
            collisions.set(arrowHandle, { arrow: arrow, scores: [] });
        }

        if (otherCollider?.userData?.type === 'target') {
            const scoreValue = colliderToScoreMap.get(otherCollider.handle);
            collisions.get(arrowHandle).scores.push(scoreValue);
        } else if (otherCollider?.userData?.type === 'floor') {
            collisions.get(arrowHandle).scores.push('M');
        }
    });
   
    for (const [arrowHandle, collisionData] of collisions.entries()) {
        const { arrow, scores } = collisionData;

        if (scores.length > 0) {
            arrow.hasScored = true;

            // Determine the best score
            const scoreValue = (s) => (s === 'X' ? 11 : (s === 'M' ? 0 : parseInt(s, 10)));
            scores.sort((a, b) => scoreValue(b) - scoreValue(a));
            arrow.score = scores[0];

            console.log(`Arrow hit target for score: ${arrow.score}`);

            // Play the "thock" sound, adjusting volume for distance
            if (arrow.score !== 'M') {
                playThockSound(arrow.distance);
            }
            
            arrow.isMoving = false;
            if (arrow.score === 'M') {
                if (arrow.body) {
                    arrow.body.setBodyType(RAPIER.RigidBodyType.Fixed);
                }
            } else {
                if (arrow.body) {
                    target.attach(arrow.mesh);
                    world.removeRigidBody(arrow.body);
                    arrow.body = null;
                }
            }
        }
    }

    // --- Game State Machine ---
    //console.log(gameState);
    // Check if the current round is over and ready for scoring
    if (gameState === GameState.SHOOTING) {
        const roundSize = 3;
        // Determine the start index of the arrows for the current round
        const currentRoundStartIndex = currentGame.scores.length;
        const expectedArrowCount = currentRoundStartIndex + roundSize;

        // Only proceed if enough arrows for the current round have been fired
        if (firedArrows.length >= expectedArrowCount) {
            // Get the specific arrows for this round
            const roundArrows = firedArrows.slice(currentRoundStartIndex, expectedArrowCount);

            // Check if all of them have landed by checking their `hasScored` flag
            const allLanded = roundArrows.every(arrow => arrow.hasScored);

            if (allLanded) {
                gameState = GameState.PROCESSING_SCORE;
                console.log(`Round ${currentGame.scores.length / 3 + 1} complete, all arrows landed. Processing scores.`);
            }
        }
    }

    switch (gameState) {
        case GameState.PROCESSING_SCORE:
            processScores();
            gameState = GameState.INSPECTING;
            console.log("Transitioning to INSPECTING state.");
            break;

        case GameState.INSPECTING:
            if (target && !target.userData.inScoringPosition) {
                scoreboardStateBeforeInspection = isScoreboardVisible;
                    isScoreboardVisible = true; // Show scoreboard when inspecting
                target.userData.inScoringPosition = true;
                // Move the visual group first, then sync the physics body to it.
                target.position.copy(target.userData.scoringPosition);
                    target.rotation.set(0, 0, 0); // Reset rotation
                if (target.userData.body) {
                    target.userData.body.setNextKinematicTranslation(target.position, true);
                    target.userData.body.setNextKinematicRotation(target.quaternion, true);
                }
            }
            break;

        case GameState.RESETTING:
            // This state will be handled by the button press logic below
            break;
    }


    if (scoreboard && scoreboard.getMesh()) {
        scoreboard.getMesh().visible = isScoreboardVisible;
    }

    if (bowController && myLine) {
        myLine.visible = isAimAssistVisible;
    } else if (myLine) {
        myLine.visible = false;
    }

    if (renderer.xr.isPresenting) {
        for (let i = 0; i < 2; i++) {
            const controller = renderer.xr.getController(i);
            if (controller && controller.gamepad) {
                // --- Grip button for holding the bow ---
                if (controller.gamepad.buttons[1].pressed) {
                    // Prevent spawning bow if this hand is holding an arrow
                    if (!bowController && controller !== arrowController) {
                        // Check distance between hands before spawning the bow
                        const otherController = renderer.xr.getController(1 - i); // Get the other controller
                        if (otherController) {
                            const distance = controller.position.distanceTo(otherController.position);
                            if (distance > 0.5) { // 50cm threshold
                                bowController = controller;
                                if (bow) bow.visible = true;
                                if (bowstring) bowstring.visible = true;
                            }
                        }
                    }
                } else {
                    if (bowController === controller) {
                        bowController = null;
                        if (bow) bow.visible = false;
                        if (bowstring) bowstring.visible = false;
                    }
                }

                // --- 'A' button for menu confirmation or scoring ---
                if (controller.gamepad.buttons[4] && controller.gamepad.buttons[4].pressed) {
                    if (!aButtonPressed[i]) {
                        aButtonPressed[i] = true;
                        if (isMenuOpen) {
                            // Re-use the same logic as onSelectStart for menu confirmation
                            onSelectStart({ target: controller });
                        } else if (gameState === GameState.INSPECTING) {
                            gameState = GameState.RESETTING;
                            console.log("Entering RESETTING state.");
                        }
                    }
                } else {
                    aButtonPressed[i] = false;
                }

                // --- 'B' button for menu back/cancel ---
                if (controller.gamepad.buttons[5] && controller.gamepad.buttons[5].pressed) {
                    if (!bButtonPressed[i]) {
                        bButtonPressed[i] = true;
                        if (isMenuOpen && currentMenuNode && currentMenuNode.parent) {
                            currentMenuNode = menuTree.submenus[currentMenuNode.parent];
                            selectedMenuIndex = 0;
                            menu.draw(currentMenuNode, selectedMenuIndex);
                            console.log(`Navigated back to ${currentMenuNode.title}`);
                        } else if (isMenuOpen) {
                            // At root, B closes the menu
                            isMenuOpen = false;
                            menu.hide();
                        }
                    }
                } else {
                    bButtonPressed[i] = false;
                }

                // --- Thumbstick press to toggle scoreboard ---
                if (controller.gamepad.buttons[3] && controller.gamepad.buttons[3].pressed) {
                    if (!thumbstickPressed[i]) {
                        thumbstickPressed[i] = true;
                        isScoreboardVisible = !isScoreboardVisible;
                    }
                } else {
                    thumbstickPressed[i] = false;
                }

                // --- Menu Toggle (Button 12) ---
                if (controller.gamepad.buttons[12] && controller.gamepad.buttons[12].pressed) {
                    if (!button12Pressed[i]) {
                        button12Pressed[i] = true;
                        isMenuOpen = !isMenuOpen;

                        if (isMenuOpen) {
                            // Reset to the main menu
                            currentMenuNode = menuTree;
                            selectedMenuIndex = 0;

                            const menuMesh = menu.getMesh();
                            const cameraDirection = new THREE.Vector3();
                            camera.getWorldDirection(cameraDirection);
                            const distance = 1.5;
                            menuMesh.position.copy(camera.position).add(cameraDirection.multiplyScalar(distance));
                            menuMesh.quaternion.copy(camera.quaternion);

                            menu.draw(currentMenuNode, selectedMenuIndex);
                            menu.show();
                            //console.log("Menu opened.");
                        } else {
                            menu.hide();
                            //console.log("Menu closed.");
                        }
                    }
                } else {
                    button12Pressed[i] = false;
                }


                // --- Joystick Navigation (History and Menu) ---
                if (controller.gamepad.axes.length > 3) {
                    const joystickY = controller.gamepad.axes[3];

                    if (Math.abs(joystickY) > 0.8) {
                        if (!joystickMoved[i]) {
                            joystickMoved[i] = true;

                            if (isMenuOpen && currentMenuNode && currentMenuNode.type !== 'info') {
                                const options = typeof currentMenuNode.getOptions === 'function' ? currentMenuNode.getOptions() : currentMenuNode.options;
                                const numOptions = options.length;
                                if (joystickY < 0) { // Up
                                    selectedMenuIndex = (selectedMenuIndex - 1 + numOptions) % numOptions;
                                } else { // Down
                                    selectedMenuIndex = (selectedMenuIndex + 1) % numOptions;
                                }
                                menu.draw(currentMenuNode, selectedMenuIndex);
                                console.log(`Selected menu index: ${selectedMenuIndex}`);
                            } else if (!isMenuOpen) {
                                // --- History Navigation ---
                                if (joystickY < 0) { // Up
                                    if (viewingGameIndex > -1) viewingGameIndex--;
                                    else if (gameHistory.length > 0) viewingGameIndex = gameHistory.length - 1;
                                } else { // Down
                                    if (viewingGameIndex < gameHistory.length - 1) viewingGameIndex++;
                                    else if (viewingGameIndex !== -1) viewingGameIndex = -1;
                                }
                                // Update scoreboard display
                                const gameToShow = (viewingGameIndex === -1) ? currentGame : gameHistory[viewingGameIndex];
                                scoreboard.displayGame(gameToShow);
                                console.log(`Viewing game #${gameToShow.gameNumber}`);
                            }
                        }
                    } else {
                        joystickMoved[i] = false; // Reset flag when stick is centered
                    }
                }
            }
        }
    }


    if (scoreboard && scoreboard.getMesh()) {
        scoreboard.getMesh().visible = isScoreboardVisible;
    }

    // --- Target Motion Logic ---
    if (gameState === GameState.SHOOTING && targetMotionState !== 'Still' && target && initialTargetPosition && target.userData.body) {
        const time = performance.now() / 1000; // Time in seconds
        const speedMap = { Slow: 0.5, Medium: 1.0, Fast: 2.0, Faster: 3.0 };
        let speed;

        if (targetMotionSpeed === 'Random') {
            const slow = speedMap.Medium;
            const fast = speedMap.Faster;
            const speedRange = (fast - slow);// / 2;
            const midSpeed = slow + speedRange;
            speed = midSpeed + Math.sin(time * 0.3) * speedRange;
        } else {
            speed = speedMap[targetMotionSpeed] || 1.0;
        }

        const newPosition = initialTargetPosition.clone();
       var qixTime,deltaTime,qixSpeedFactor,moveStep,distance,directionFromOrigin;
        switch (targetMotionState) {
            case 'Left & Right':
                newPosition.x += Math.sin(time * speed);
                break;
            case 'Up & Down':
                newPosition.y += 1 + Math.sin(time * speed);
                break;
            case 'Random Seated': //keep target within sight while seated. -40deg left, 40deg right
                qixTime = time;
                if (qixTime > qixMotionStartTime + qixMotionDuration) {
                    qixMotionStartTime = qixTime;
                    qixMotionDuration = Math.random() * 8 + 2; // Move for 2-10 seconds
                    randomMotionStartPosition.copy(target.position);

                    qixMotionDirection.set(
                        Math.random() - 0.5,
                        Math.random() - 0.5,
                        Math.random() - 0.5
                    ).normalize();
                }

                deltaTime = time - (lastTimestamp > 0 ? lastTimestamp : time);
                lastTimestamp = time;

                qixSpeedFactor = 0.2;
                moveStep = qixSpeedFactor * speed * deltaTime;

                newPosition.copy(target.position).addScaledVector(qixMotionDirection, moveStep);

                // Project the new position back onto the sphere of the correct radius
                distance = -target.userData.shootingPosition.z;
                newPosition.normalize().multiplyScalar(distance);
                
                const maxAngle = 40 * (Math.PI / 180); // 40 degrees in radians
                const currentAngle = Math.atan2(newPosition.x, -newPosition.z);

                if (Math.abs(currentAngle) > maxAngle) {
                    const clampedAngle = Math.sign(currentAngle) * maxAngle;

                    const xzMagnitude = Math.sqrt(newPosition.x * newPosition.x + newPosition.z * newPosition.z);

                    newPosition.x = xzMagnitude * Math.sin(clampedAngle);
                    newPosition.z = -xzMagnitude * Math.cos(clampedAngle);


                    // Reflect the motion direction
                    let normal;
                    if (currentAngle > maxAngle) { // Right boundary
                        normal = new THREE.Vector3(-Math.cos(maxAngle), 0, -Math.sin(maxAngle));
                    } else { // Left boundary
                        normal = new THREE.Vector3(Math.cos(maxAngle), 0, -Math.sin(maxAngle));
                    }
                    qixMotionDirection.reflect(normal);
                }
                //distance = -target.userData.shootingPosition.z;
               // directionFromOrigin = newPosition.clone().normalize();
                //newPosition.copy(directionFromOrigin).multiplyScalar(distance);

                if (floorBody && newPosition.y < floorBody.translation().y + 1.0) {
                    newPosition.y = floorBody.translation().y + 1.0;
                }
                break;
                case 'Random Standing': //360 shooting.
                qixTime = time;
                if (qixTime > qixMotionStartTime + qixMotionDuration) {
                    qixMotionStartTime = qixTime;
                    qixMotionDuration = Math.random() * 8 + 2; // Move for 2-10 seconds
                    randomMotionStartPosition.copy(target.position);

                    qixMotionDirection.set(
                        Math.random() - 0.5,
                        Math.random() - 0.5,
                        Math.random() - 0.5
                    ).normalize();
                }

                deltaTime = time - (lastTimestamp > 0 ? lastTimestamp : time);
                lastTimestamp = time;

                qixSpeedFactor = 0.2;
                moveStep = qixSpeedFactor * speed * deltaTime;

                newPosition.copy(target.position).addScaledVector(qixMotionDirection, moveStep);

                distance = -target.userData.shootingPosition.z;
                //directionFromOrigin = newPosition.clone().normalize();
                //newPosition.copy(directionFromOrigin).multiplyScalar(distance);
                newPosition.normalize().multiplyScalar(distance);

                if (floorBody && newPosition.y < floorBody.translation().y + 1.0) {
                    newPosition.y = floorBody.translation().y + 1.0;
                }
                break;
        }

        target.position.copy(newPosition);
        target.userData.body.setNextKinematicTranslation(newPosition, true);
        target.lookAt(camera.position);
        target.userData.body.setNextKinematicRotation(target.quaternion, true);
    }


    if (gameState === GameState.RESETTING) {
        isScoreboardVisible = scoreboardStateBeforeInspection;
        cleanupRound();
        gameState = GameState.SHOOTING;
        console.log("Returning to SHOOTING state.");
    }

    if (bowController && bow) {
        const controller = renderer.xr.getController(bowController.userData.id);
        const offsetRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
        const finalRotation = controller.quaternion.clone().multiply(offsetRotation);
        bow.position.copy(controller.position);
        bow.quaternion.copy(finalRotation);

        if (bowHUD) {
            const hudMesh = bowHUD.getMesh();
            hudMesh.visible = isHudVisible; // Toggle visibility based on the flag

            if (isHudVisible) {
                // Position the HUD to the right of the bow
                const offsetDirection = (bowController.userData.id === 0) ? 1 : -1;
                const rightDirection = new THREE.Vector3(-offsetDirection, 0, 0).applyQuaternion(controller.quaternion);
                hudMesh.position.copy(controller.position).add(rightDirection.multiplyScalar(0.3)); // 30cm to the right

                // Make the HUD face the camera/user
                hudMesh.quaternion.copy(camera.quaternion);
            }
        }
        /*
        if (arrowCamViewer) {
            // Position the Arrow Cam viewer above the HUD
            const rightDirection = new THREE.Vector3(-offsetDirection, 0, 0).applyQuaternion(controller.quaternion);
            arrowCamViewer.position.copy(controller.position).add(rightDirection.multiplyScalar(0.3)).add(new THREE.Vector3(0, 0.25, 0).applyQuaternion(controller.quaternion));
            arrowCamViewer.quaternion.copy(camera.quaternion);
        }
*/
    } else {
        if (bowHUD) bowHUD.getMesh().visible = false;
        //if (arrowCamViewer) arrowCamViewer.visible = false;
    }

    if (bowHUD && isHudVisible && bowHUD.getMesh().visible) {
        let scoresToShow = hudScores;
        // If the hudScores array is empty (i.e., we are in a new round),
        // show the scores for the arrows shot so far in the current round.
        if (scoresToShow.length === 0) {
            const roundSize = 3;
            const currentRoundIndex = Math.floor(currentGame.scores.length / roundSize);
            const startIndex = currentRoundIndex * roundSize;
            const relevantArrows = firedArrows.slice(startIndex, startIndex + roundSize);
            scoresToShow = relevantArrows.map(a => a.score);
        }

        // Prioritize showing stats for the currently held arrow, otherwise show the last fired one.
        const arrowForHUD = arrowObject || lastFiredArrow;

        bowHUD.update({
            scores: scoresToShow,
            lastArrow: arrowForHUD
        });
    }


if (bowController) {
  const LINE_LENGTH = 0.05;
    // 1. Get the controller object for the bow hand.
    const bowHand = renderer.xr.getController(bowController.userData.id);

    // 2. Define the "left" direction and the desired line length.
        const offsetDirection = (bowController.userData.id === 0) ? 1 : -1; // Left hand is 0, right is 1
        const LOCAL_LEFT = new THREE.Vector3(offsetDirection, 0, 0);


    // 3. Get the controller's current world position and rotation.
    const controllerPosition = new THREE.Vector3();
    const controllerQuaternion = new THREE.Quaternion();
    bowHand.getWorldPosition(controllerPosition);
    bowHand.getWorldQuaternion(controllerQuaternion);

    // 4. The near point of your line is the controller's position.
    const nearPoint = controllerPosition;

    // 5. Transform the local "left" vector into a world-space direction.
    const worldLeftDirection = LOCAL_LEFT.clone().applyQuaternion(controllerQuaternion);

    // 6. Calculate the far point.
    const farPoint = new THREE.Vector3()
        .copy(controllerPosition)
        .add(worldLeftDirection.multiplyScalar(LINE_LENGTH));

    // 7. Update the line's geometry with the new points.
    //    (Assuming 'myLine' is the THREE.Line object you created earlier)
    myLine.geometry.attributes.position.setXYZ(0, nearPoint.x, nearPoint.y, nearPoint.z);
    myLine.geometry.attributes.position.setXYZ(1, farPoint.x, farPoint.y, farPoint.z);
    myLine.geometry.attributes.position.needsUpdate = true;
}

    // --- Proximity Nocking ---
    if (arrowObject && !arrowObject.isNocked && bowController && arrowController) {
        const bowHand = renderer.xr.getController(bowController.userData.id);
        const arrowHand = renderer.xr.getController(arrowController.userData.id);
        const distance = bowHand.position.distanceTo(arrowHand.position);
        if (distance < 0.15 && gameState === GameState.SHOOTING) { // 10cm threshold
            console.log("Nocking arrow by proximity.");
            arrowObject.isNocked = true;
            // Detach arrow from controller and add to scene to allow independent drawing motion.
            scene.attach(arrowObject.mesh);
        }
    }

    // --- Arrow Drawing Logic (only when nocked) ---
    if (arrowController && arrowObject && arrowObject.isNocked && arrowObject.body && bowController) {
        const arrowHand = renderer.xr.getController(arrowController.userData.id);
        const bowHand = renderer.xr.getController(bowController.userData.id);
        const arrowBody = arrowObject.body;
        const mesh = arrowObject.mesh;
        const { forward: localForward, nock: localNock, length: arrowLength } = arrowTemplate.userData;
        offsetDirection = (bowController.userData.id === 0) ? 1 : -1; // Left hand is 0, right is 1
        LOCAL_LEFT = new THREE.Vector3(offsetDirection, 0, 0);

        const worldLeftDirection = LOCAL_LEFT.clone().applyQuaternion(bowHand.quaternion);

        const arrowRestPosition = new THREE.Vector3()
            .copy(bowHand.position)
            .add(worldLeftDirection.multiplyScalar(OFFSET_DISTANCE));

        const directionToRest = new THREE.Vector3().subVectors(arrowRestPosition, arrowHand.position);
        const drawDirection = directionToRest.clone().negate().normalize();
        const drawDistance = directionToRest.length();
        const clampedDrawDistance = Math.min(drawDistance, arrowLength);
        const clampedNockPosition = new THREE.Vector3().copy(arrowRestPosition).add(drawDirection.clone().multiplyScalar(clampedDrawDistance));

        const rotation = new THREE.Quaternion().setFromUnitVectors(localForward, drawDirection.clone().negate());
        mesh.quaternion.copy(rotation);

        const rotatedNockOffset = localNock.clone().applyQuaternion(rotation);
        mesh.position.copy(clampedNockPosition).sub(rotatedNockOffset);

        arrowBody.setNextKinematicTranslation(mesh.position);
        arrowBody.setNextKinematicRotation(mesh.quaternion);

        // Also update the angle for the HUD while nocked
        const worldTip = arrowTemplate.userData.tip.clone().applyMatrix4(mesh.matrixWorld);
        const worldNock = localNock.clone().applyMatrix4(mesh.matrixWorld);
        const arrowVector = new THREE.Vector3().subVectors(worldTip, worldNock);
        arrowObject.angle = Math.atan2(arrowVector.y, Math.sqrt(arrowVector.x * arrowVector.x + arrowVector.z * arrowVector.z)) * (180 / Math.PI);

        arrowObject.nockPosition = clampedNockPosition;
    } else if (arrowObject) {
        arrowObject.nockPosition = null;
    }


    firedArrows.forEach(obj => {
        if (obj.body) {
            // Always update the mesh position from the physics body
            obj.mesh.position.copy(obj.body.translation());

            const velocity = obj.body.linvel();
            const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z);

            // Update HUD data
            
            obj.speed = speed;
            obj.topSpeed = Math.max(obj.topSpeed, speed);
            obj.distance = obj.mesh.position.distanceTo(camera.position);
            obj.altitude = obj.mesh.position.y - (floorBody ? floorBody.translation().y : 0);
            //alt=obj.altitude;
            //console.log("AO:",obj);
            //if (obj.altitude<0) { collisions.get(arrowHandle).scores.push('M'); }
            obj.maxAltitude = Math.max(obj.maxAltitude, obj.altitude);

            if (obj.altitude < 0 && !obj.hasScored) {
                obj.hasScored = true;
                obj.score = 'M';
                obj.isMoving = false;
                if (obj.body) {
                    obj.body.setBodyType(RAPIER.RigidBodyType.Fixed);
                }
            }

            // For arrows in flight with significant velocity, align their visual mesh with the velocity vector
            if (obj.body.isDynamic() && speed > 0.1 && arrowTemplate) {
                const worldVelocity = new THREE.Vector3(velocity.x, velocity.y, velocity.z).normalize();
                const localForward = arrowTemplate.userData.forward;

                // Create a quaternion that rotates the local forward vector to align with the world velocity
                const rotation = new THREE.Quaternion().setFromUnitVectors(localForward, worldVelocity);
                obj.body.setRotation(rotation, true);
            }

            // Calculate angle based on geometry
            const worldTip = arrowTemplate.userData.tip.clone().applyMatrix4(obj.mesh.matrixWorld);
            const worldNock = arrowTemplate.userData.nock.clone().applyMatrix4(obj.mesh.matrixWorld);
            const arrowVector = new THREE.Vector3().subVectors(worldTip, worldNock);
            obj.angle = Math.atan2(arrowVector.y, Math.sqrt(arrowVector.x * arrowVector.x + arrowVector.z * arrowVector.z)) * (180 / Math.PI);
            // Always update the mesh quaternion from the physics body
            obj.mesh.quaternion.copy(obj.body.rotation());
        }
    });

    if (bow && bowstring) {
        const positions = bowstring.geometry.attributes.position.array;
        const topPointLocal = bow.userData.top;
        const bottomPointLocal = bow.userData.bottom;
        const topPointWorld = topPointLocal.clone().applyMatrix4(bow.matrixWorld);
        const bottomPointWorld = bottomPointLocal.clone().applyMatrix4(bow.matrixWorld);

        if (arrowController && arrowObject && arrowObject.nockPosition) {
            const nockPosition = arrowObject.nockPosition;
            positions[0] = topPointWorld.x; positions[1] = topPointWorld.y; positions[2] = topPointWorld.z;
            positions[3] = nockPosition.x; positions[4] = nockPosition.y; positions[5] = nockPosition.z;
            positions[6] = bottomPointWorld.x; positions[7] = bottomPointWorld.y; positions[8] = bottomPointWorld.z;
        } else {
            positions[0] = topPointWorld.x; positions[1] = topPointWorld.y; positions[2] = topPointWorld.z;
            positions[3] = bottomPointWorld.x; positions[4] = bottomPointWorld.y; positions[5] = bottomPointWorld.z;
            positions[6] = bottomPointWorld.x; positions[7] = bottomPointWorld.y; positions[8] = bottomPointWorld.z;
        }
        bowstring.geometry.attributes.position.needsUpdate = true;
        bowstring.geometry.computeBoundingSphere();
    }
/*
    // --- Arrow Cam Rendering ---
    if (isArrowCamVisible && lastFiredArrow && lastFiredArrow.isMoving && lastFiredArrow.distance > 9) {
        arrowCamViewer.visible = true;

        // Position the arrow camera behind and slightly above the arrow
        const arrowMesh = lastFiredArrow.mesh;
        const offset = new THREE.Vector3(0, 0.1, 0.5).applyQuaternion(arrowMesh.quaternion);
        arrowCamera.position.copy(arrowMesh.position).add(offset);
        arrowCamera.lookAt(arrowMesh.position);

        // Render the arrow camera's view to the render target
        renderer.setRenderTarget(arrowCamRenderTarget);
        renderer.render(scene, arrowCamera);
        renderer.setRenderTarget(null); // Reset render target
    }

*/
    rapierDebugRenderer.update();
    renderer.render(scene, camera);
}

function processScores() {
    const roundSize = 3;
    const startIndex = currentGame.scores.length;
    if (firedArrows.length < startIndex + roundSize) {
        return;
    }

    // Identify and store the arrows for the current round
    currentRoundArrows = firedArrows.slice(startIndex, startIndex + roundSize);

    const scores = currentRoundArrows.map(arrow => arrow.score || 'M');

    // Sort scores for display (X is highest)
    const scoreValueForSort = (s) => (s === 'X' ? 11 : (s === 'M' ? 0 : parseInt(s, 10)));
    scores.sort((a, b) => scoreValueForSort(b) - scoreValueForSort(a));

    // Update the persistent HUD scores
    hudScores = scores;

    // Add new scores to the current game object
    currentGame.scores.push(...scores);

    // Recalculate all totals for the current game
    currentGame = calculateGameTotals(currentGame);

    // Update the scoreboard with the new data
    scoreboard.displayGame(currentGame);
}

function cleanupRound() {
    // Clean up the arrows from the round that was just inspected
    currentRoundArrows.forEach(obj => {
        if (obj.mesh) obj.mesh.removeFromParent();
        if (obj.body) {
            try { world.removeRigidBody(obj.body); } catch (e) {}
            obj.body = null; // Nullify the body to prevent future access
        }
    });
    currentRoundArrows = []; // Clear the temporary array

    // Clear the HUD scores for the next round
    hudScores = [];

    // Reset target position
    if (target) {
        target.userData.inScoringPosition = false;
        // Move the visual group first, then sync the physics body to it.
        target.position.copy(target.userData.shootingPosition);
        if (target.userData.body) {
            target.userData.body.setNextKinematicTranslation(target.position, true);
            target.userData.body.setNextKinematicRotation(target.quaternion, true);
        }
    }

    // After 12 arrows are scored, finalize the game
    if (currentGame.scores.length >= 12) {
        console.log("Full 12-shot game finished. Saving to history.");
        gameHistory.push(currentGame);
        runningTotal = currentGame.runningTotal;
        startNewGame();
    }
}

// --- Game Logic ---

function startNewGame() {
    currentGame = {
        gameNumber: gameHistory.length + 1,
        scores: [],
        end1Total: 0,
        end2Total: 0,
        dozenTotal: 0,
        hits: 0,
        golds: 0,
        runningTotal: runningTotal // Carry over the running total
    };
    firedArrows = [];
    currentRoundArrows = [];
    viewingGameIndex = -1; // View the new current game
    scoreboard.displayGame(currentGame);
    console.log(`Starting Game #${currentGame.gameNumber}`);
}

function calculateGameTotals(game) {
    const parseScore = (s) => (s === 'X' ? 10 : (s === 'M' ? 0 : parseInt(s, 10)));
    const scoresNumeric = game.scores.map(parseScore);

    game.end1Total = scoresNumeric.slice(0, 6).reduce((a, b) => a + b, 0);
    game.end2Total = scoresNumeric.slice(6, 12).reduce((a, b) => a + b, 0);
    game.dozenTotal = game.end1Total + game.end2Total;
    game.hits = game.scores.filter(s => s !== 'M').length;
    game.golds = game.scores.filter(s => s === 'X' || s === '10').length;

    // R/T is the sum of previous games' dozen totals plus the current game's dozen total
    game.runningTotal = runningTotal + game.dozenTotal;

    return game;
}

// --- Sound Synthesis Functions ---

function playTwangSound() {
    if (!audioCtx) return;

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(100, audioCtx.currentTime); // Start at a low frequency

    gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.3);
}

function playThockSound(distance) {
    if (!audioCtx) return;

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // A low-frequency sine wave for a "thock"
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(80, audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);


    // Volume decreases with distance
    const maxDistance = 50; // The distance at which the sound is barely audible
    const volume = Math.max(0, 1 - (distance / maxDistance));

    gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01 * volume, audioCtx.currentTime + 0.15);


    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.15);
}

function saveSettings() {
    const settings = {
        isScoreboardVisible,
        isAimAssistVisible,
        isHudVisible
    };
        //isArrowCamVisible
    localStorage.setItem('archerySettings', JSON.stringify(settings));
}

function loadSettings() {
    const savedSettings = localStorage.getItem('archerySettings');
    if (savedSettings) {
        const settings = JSON.parse(savedSettings);
        isScoreboardVisible = settings.isScoreboardVisible ?? true;
        isAimAssistVisible = settings.isAimAssistVisible ?? true;
        isHudVisible = settings.isHudVisible ?? true;
    }
        //isArrowCamVisible = settings.isArrowCamVisible ?? true;
}


init();