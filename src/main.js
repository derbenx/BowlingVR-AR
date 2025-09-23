import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

async function main() {
    await RAPIER.init();

    // 1. Scene Setup
    const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaaaaaa); // Use a light gray background

    // Physics World
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    const world = new RAPIER.World(gravity);

    // Physics Ground
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(10, 0.1, 10);
    world.createCollider(groundColliderDesc);


    // 2. Camera
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 5); // Move camera up and back
camera.lookAt(0, 0, 0);

// 3. Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 4. Lighting
const ambientLight = new THREE.AmbientLight(0x404040, 2); // soft white light
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 5, 5);
scene.add(directionalLight);

    // 5. Create Game Elements

    // Visual ground
    const groundSize = { width: 20, height: 0.2, depth: 20 };
    const groundGeometry = new THREE.BoxGeometry(groundSize.width, groundSize.height, groundSize.depth);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.position.y = -0.1; // Match the physics ground
    scene.add(groundMesh);

    // Array to hold dynamic objects
    let dynamicObjects = [];

    // Create Bowling Ball
    const ballRadius = 0.2;
    const ballGeometry = new THREE.SphereGeometry(ballRadius, 32, 32);
    const ballMaterial = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.2 });
    const ballMesh = new THREE.Mesh(ballGeometry, ballMaterial);

    const ballInitialPosition = { x: 0, y: 0.5, z: 8 };
    const ballBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(ballInitialPosition.x, ballInitialPosition.y, ballInitialPosition.z);
    const ballBody = world.createRigidBody(ballBodyDesc);
    const ballColliderDesc = RAPIER.ColliderDesc.ball(ballRadius);
    world.createCollider(ballColliderDesc, ballBody);

    dynamicObjects.push({ mesh: ballMesh, body: ballBody, initialPosition: ballInitialPosition, isBall: true });
    scene.add(ballMesh);

    // Create Bowling Pins
    const pinHeight = 0.5;
    const pinRadius = 0.05;
    const pinGeometry = new THREE.CylinderGeometry(pinRadius, pinRadius, pinHeight, 16);
    const pinMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });

    function createPin(x, z) {
        const pinMesh = new THREE.Mesh(pinGeometry, pinMaterial);
        const initialPosition = { x: x, y: pinHeight / 2, z: z };

        const pinBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(initialPosition.x, initialPosition.y, initialPosition.z);
        const pinBody = world.createRigidBody(pinBodyDesc);
        const pinColliderDesc = RAPIER.ColliderDesc.cylinder(pinHeight / 2, pinRadius);
        world.createCollider(pinColliderDesc, pinBody);

        dynamicObjects.push({ mesh: pinMesh, body: pinBody, initialPosition: initialPosition });
        scene.add(pinMesh);
    }

    // Layout pins in a triangle
    const pinSpacing = 0.2;
    const pinStartZ = -5;
    let pinCount = 0;
    for (let row = 0; row < 4; row++) {
        for (let i = 0; i < row + 1; i++) {
            const x = (i - row / 2) * pinSpacing * 2;
            const z = pinStartZ - row * pinSpacing * 1.732; // 1.732 is ~sqrt(3) for equilateral triangle
            createPin(x, z);
            pinCount++;
        }
    }


    // 6. Animation Loop
    function animate() {
        requestAnimationFrame(animate);

        // Step the physics world
        world.step();

        // Update all dynamic objects
        dynamicObjects.forEach(obj => {
            obj.mesh.position.copy(obj.body.translation());
            obj.mesh.quaternion.copy(obj.body.rotation());
        });

        renderer.render(scene, camera);
    }

    // User Interaction

    // Left-click to throw
    window.addEventListener('click', () => {
        const ball = dynamicObjects.find(obj => obj.isBall);
        if (ball) {
            // Only throw if the ball is reasonably still at the start
            const isIdle = Math.abs(ball.body.linvel().z) < 0.1 && Math.abs(ball.body.linvel().x) < 0.1;
            if (isIdle) {
                 ball.body.applyImpulse({ x: 0, y: 0, z: -8 }, true); // Reduced force
            }
        }
    });

    // Right-click to reset
    window.addEventListener('contextmenu', (event) => {
        event.preventDefault(); // Prevent default context menu
        // Reset all dynamic objects
        dynamicObjects.forEach(obj => {
            obj.body.setTranslation(obj.initialPosition, true);
            obj.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            obj.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        });
    });

// 7. Handle Window Resizing
    window.addEventListener('resize', () => {
    // Update camera aspect ratio
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    // Update renderer size
    renderer.setSize(window.innerWidth, window.innerHeight);
});

    // Start the animation
    animate();
}

main();
