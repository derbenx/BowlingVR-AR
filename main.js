import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { XRPlanes } from './XRPlanes.js';

async function main() {
    await RAPIER.init();

    const scene = new THREE.Scene();
    const world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 2, 5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0x404040, 2);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    const loader = new GLTFLoader();
    let dynamicObjects = [];
    let groundBody;

    async function createScene(basePosition) {
        const laneGltf = await loader.loadAsync('3d/lane.glb');
        const groundMesh = laneGltf.scene;
        scene.add(groundMesh);
        groundMesh.position.copy(basePosition);
        groundMesh.userData.isLane = true;

        const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(basePosition.x, basePosition.y, basePosition.z);
        groundBody = world.createRigidBody(groundBodyDesc);

        groundMesh.traverse(child => {
            if (child.isMesh) {
                child.updateMatrixWorld(true);
                const originalVertices = child.geometry.attributes.position.array;
                const transformedVertices = new Float32Array(originalVertices.length);
                const tempVec = new THREE.Vector3();
                for (let i = 0; i < originalVertices.length; i += 3) {
                    tempVec.set(originalVertices[i], originalVertices[i + 1], originalVertices[i + 2]);
                    tempVec.applyMatrix4(child.matrixWorld);
                    transformedVertices[i] = tempVec.x;
                    transformedVertices[i + 1] = tempVec.y;
                    transformedVertices[i + 2] = tempVec.z;
                }
                const indices = child.geometry.index.array;
                const trimeshDesc = RAPIER.ColliderDesc.trimesh(transformedVertices, indices);
                world.createCollider(trimeshDesc, groundBody);
            }
        });

        const pinGltf = await loader.loadAsync('3d/pin.glb');
        const pinModel = pinGltf.scene;
        let pinVertices;
        pinModel.traverse(child => {
            if (child.isMesh) {
                child.updateMatrixWorld(true);
                const originalVertices = child.geometry.attributes.position.array;
                pinVertices = new Float32Array(originalVertices.length);
                const tempVec = new THREE.Vector3();
                for (let i = 0; i < originalVertices.length; i += 3) {
                    tempVec.set(originalVertices[i], originalVertices[i + 1], originalVertices[i + 2]);
                    tempVec.applyMatrix4(child.matrixWorld);
                    pinVertices[i] = tempVec.x;
                    pinVertices[i+1] = tempVec.y;
                    pinVertices[i+2] = tempVec.z;
                }
            }
        });

        const createPin = (x, z) => {
            const pinMesh = pinModel.clone();
            const initialPosition = new THREE.Vector3(x, 0, z).add(basePosition);
            pinMesh.position.copy(initialPosition);

            const pinBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(initialPosition.x, initialPosition.y, initialPosition.z);
            const pinBody = world.createRigidBody(pinBodyDesc);
            const colliderDesc = RAPIER.ColliderDesc.convexHull(pinVertices);
            world.createCollider(colliderDesc, pinBody);
            dynamicObjects.push({ mesh: pinMesh, body: pinBody, initialPosition: initialPosition });
            scene.add(pinMesh);
        };

        const pinSpacing = 0.2;
        const pinStartZ = -3.5;
        for (let row = 0; row < 4; row++) {
            for (let i = 0; i < row + 1; i++) {
                const x = (i - row / 2) * pinSpacing * 2;
                const z = pinStartZ - row * pinSpacing * 1.732;
                createPin(x, z);
            }
        }
    }

    await createScene(new THREE.Vector3(0, 0, 0));

    const planes = new XRPlanes(renderer);
    planes.visible = false;
    // scene.add(planes); // No need to add to the scene if not visible

    let arModeActive = false;
    let scenePlacedInAR = false;

    renderer.xr.addEventListener('sessionstart', () => {
        arModeActive = true;
    });

    renderer.setAnimationLoop(() => {
        if (arModeActive && !scenePlacedInAR) {
            let fY = 1000; // Initialize with a large value
            let floorPlaneFound = false;
            for (const planeMesh of planes.children) {
                if (planeMesh.userData.xrPlane && planeMesh.userData.xrPlane.orientation === 'horizontal') {
                    fY = Math.min(fY, planeMesh.position.y);
                    floorPlaneFound = true;
                }
            }

            if (floorPlaneFound) {
                const xrCamera = renderer.xr.getCamera();
                const cameraPosition = new THREE.Vector3();
                xrCamera.getWorldPosition(cameraPosition);

                const forward = new THREE.Vector3(0, 0, -1);
                forward.applyQuaternion(xrCamera.quaternion);

                const targetPosition = new THREE.Vector3();
                targetPosition.copy(cameraPosition).add(forward.multiplyScalar(1));
                targetPosition.y = fY;

                const offset = new THREE.Vector3().copy(targetPosition);

                groundBody.setTranslation(offset, true);
                const groundMesh = scene.getObjectByProperty('isLane', true);
                if (groundMesh) groundMesh.position.copy(offset);

                dynamicObjects.forEach(obj => {
                    const newPos = new THREE.Vector3().copy(obj.initialPosition).add(offset);
                    obj.body.setTranslation(newPos, true);
                });
                scenePlacedInAR = true;
            }
        }

        world.step();
        dynamicObjects.forEach(obj => {
            obj.mesh.position.copy(obj.body.translation());
            obj.mesh.quaternion.copy(obj.body.rotation());
        });
        renderer.render(scene, camera);
    });

    document.body.appendChild(ARButton.createButton(renderer, { requiredFeatures: ['plane-detection'] }));
}

main();