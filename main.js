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
let world,planes,ARcheck;

class DebugMeshManager {
    constructor(scene, world) {
        this.scene = scene;
        this.world = world;
        this.meshes = new Map();
        this.material = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.5,
        });
    }

    createMeshForCollider(collider, customVertices = null) {
        const shape = collider.shape;
        let geometry;

        switch (shape.type) {
            case RAPIER.ShapeType.Cuboid: {
                const he = shape.halfExtents;
                geometry = new THREE.BoxGeometry(he.x * 2, he.y * 2, he.z * 2);
                break;
            }
            case RAPIER.ShapeType.Ball: {
                geometry = new THREE.SphereGeometry(shape.radius);
                break;
            }
            case RAPIER.ShapeType.Capsule: {
                // Using a cylinder as a visual proxy for the capsule
                geometry = new THREE.CylinderGeometry(shape.radius, shape.radius, shape.halfHeight * 2, 16);
                break;
            }
            case RAPIER.ShapeType.TriMesh: {
                const trimesh = shape;
                const vertices = trimesh.vertices;
                const indices = trimesh.indices;
                geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
                geometry.setIndex(new THREE.BufferAttribute(indices, 1));
                geometry.computeVertexNormals();
                break;
            }
            case RAPIER.ShapeType.ConvexPolyhedron: {
                const vertices = customVertices || shape.vertices;
                if (!vertices) return; // Do not create a mesh if vertices are null

                const points = [];
                for (let i = 0; i < vertices.length; i += 3) {
                    points.push(new THREE.Vector3(vertices[i], vertices[i + 1], vertices[i + 2]));
                }
                geometry = new ConvexGeometry(points);
                break;
            }
            default:
                console.warn(`Unsupported collider shape type: ${shape.type}`);
                return;
        }

        const mesh = new THREE.Mesh(geometry, this.material);
        this.scene.add(mesh);
        this.meshes.set(collider.handle, mesh);
    }

    update() {
        this.world.forEachCollider(collider => {
            const mesh = this.meshes.get(collider.handle);
            if (!mesh) return;

            const parentBody = collider.parent();

            if (parentBody) {
                const bodyPos = parentBody.translation();
                const bodyRot = parentBody.rotation();
                const colliderPos = collider.translation();
                const colliderRot = collider.rotation();

                const position = new THREE.Vector3().copy(colliderPos).applyQuaternion(bodyRot).add(bodyPos);
                const quaternion = new THREE.Quaternion().copy(bodyRot).multiply(colliderRot);

                mesh.position.copy(position);
                mesh.quaternion.copy(quaternion);
            } else {
                mesh.position.copy(collider.translation());
                mesh.quaternion.copy(collider.rotation());
            }
        });
    }
}

async function main() {
    await RAPIER.init();
    

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(ARButton.createButton(renderer, { requiredFeatures: ['local-floor','plane-detection'] }));

    // Setup plane detection
    planes = new XRPlanes(renderer);
    //planes.visible = false;
    //scene.add(planes);

 ARcheck=setInterval(check,150);

 if (navigator.xr && navigator.xr.isSessionSupported) {
    navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
      if (supported && navigator.xr.requestSession) {
        navigator.xr.requestSession('immersive-vr', {
          //optionalFeatures: ['local-floor'],
          optionalFeatures: ['local-floor','plane-detection'],
        })
        .then((session) => {renderer.xr.setSession(session);});
      }
    });
  }
}

function check(){
 
 if (renderer.xr.isPresenting && planes.children.length){
   //console.log(planeMesh.userData.xrPlane._semanticLabel);
   console.log(planes.children[0]);
   console.log(planes.children[0].position.y);
  clearInterval(ARcheck);
  init(); 
 }
 //console.log(planes.children.length);
}
async function init() {

    let debugMeshManager;
    if (dbg) {
        debugMeshManager = new DebugMeshManager(scene, world);
    }

    //const gravity = { x: 0.0, y: -.5 , z: 0.0 };
    //const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    const world = new RAPIER.World(gravity);

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 5); // Move camera up and back
camera.lookAt(0, 0, 0);


// 4. Lighting
const ambientLight = new THREE.AmbientLight(0x404040, 2); // soft white light
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 5, 5);
scene.add(directionalLight);

    // 5. Create Game Elements
    const loader = new GLTFLoader();


    var fY=0;
    //console.log(planes.children);
    for (const planeMesh of planes.children) {
     fY = planeMesh.position.y<fY ? planeMesh.position.y : fY;
     console.log(planeMesh.position);
     //let pln=typeof planeMesh.userData.xrPlane.semanticLabel ? planeMesh.userData.xrPlane.semanticLabel : planeMesh.userData.xrPlane._semanticLabel;
     //console.log(pln); //actually says 'floor', 'wall', 'ceiling'
    }
   //console.log(fY);

    // Load Lane Model
    const laneGltf = await loader.loadAsync('3d/lane.glb');
   
    // Visual ground and Physics Ground
    const groundMesh = laneGltf.scene;
    groundMesh.position.y=fY;

    // Create a fixed rigid body for the lane.
    const laneBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, fY, 0);
    const laneBody = world.createRigidBody(laneBodyDesc);

    // Create a trimesh collider from the lane's geometry
    groundMesh.traverse(child => {
        if (child.isMesh) {
            const vertices = child.geometry.attributes.position.array;
            const indices = child.geometry.index.array;
            const trimeshDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
            world.createCollider(trimeshDesc, laneBody);
            // No need for debug mesh for a static body
        }
    });

    scene.add(groundMesh);


    

    // Array to hold dynamic objects
    let dynamicObjects = [];

    // Create Bowling Ball
    const ballGltf = await loader.loadAsync('3d/ball.glb');
    const ballMesh = ballGltf.scene;
    const ballBox = new THREE.Box3().setFromObject(ballMesh);
    const ballSize = ballBox.getSize(new THREE.Vector3());
    const ballRadius = ballSize.x / 2;

    const ballInitialPosition = { x: 0, y: fY+.5 , z: 0  };
    const ballBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(ballInitialPosition.x, ballInitialPosition.y, ballInitialPosition.z);
    const ballBody = world.createRigidBody(ballBodyDesc);
    const ballColliderDesc = RAPIER.ColliderDesc.ball(ballRadius);
    const ballCollider = world.createCollider(ballColliderDesc, ballBody);
    if(dbg) debugMeshManager.createMeshForCollider(ballCollider);

    dynamicObjects.push({ mesh: ballMesh, body: ballBody, initialPosition: ballInitialPosition, isBall: true });
    scene.add(ballMesh);
    ballMesh.visible = true;

    // Create Bowling Pins
    const pinGltf = await loader.loadAsync('3d/pin.glb');
    const pinModel = pinGltf.scene;
    
    // Extract transformed vertices from the pin model for the convex hull
    let pinVertices;
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

    function createPin(x, z) {
        const pinMesh = pinModel.clone();

        // The initial position for both the mesh and the body is the center of the physics shape.
        const initialPosition = { x: x, y: fY, z: z };

        const pinBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(initialPosition.x, initialPosition.y, initialPosition.z);
        const pinBody = world.createRigidBody(pinBodyDesc);

        // Create a convex hull collider from the pin's geometry
        const colliderDesc = RAPIER.ColliderDesc.convexHull(pinVertices);
        const collider = world.createCollider(colliderDesc, pinBody);
        if (dbg) debugMeshManager.createMeshForCollider(collider, pinVertices);

        dynamicObjects.push({ mesh: pinMesh, body: pinBody, initialPosition: initialPosition });
        scene.add(pinMesh);
        pinMesh.visible = true;
    }

    // Layout pins in a triangle
    const pinSpacing = 0.2 ;
    const pinStartZ = -3.5 ;
    let pinCount = 0;
    for (let row = 0; row < 4; row++) {
        for (let i = 0; i < row + 1; i++) {
            const x = (i - row / 2) * pinSpacing * 2;
            const z = pinStartZ - row * pinSpacing * 1.732; // 1.732 is ~sqrt(3) for equilateral triangle
            createPin(x, z);
            pinCount++;
        }
    }


    let placementMatrix = new THREE.Matrix4();
    let isScenePlaced = false;

    // 6. Animation Loop
    function animate(timestamp, frame) {
        // Step the physics world first
        world.step();

        if (dbg) debugMeshManager.update();

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
    }

    


// 7. Handle Window Resizing
    window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

    // Start the animation
    renderer.setAnimationLoop(animate);

    let holdingController = null;

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
        controller.addEventListener('selectstart', onSelectStart);
        controller.addEventListener('selectend', onSelectEnd);
        scene.add(controller);

        const controllerGrip = renderer.xr.getControllerGrip(controllerIndex);
        controllerGrip.add(controllerModelFactory.createControllerModel(controllerGrip));
        scene.add(controllerGrip);
    }

    setupController(0);
    setupController(1);


}

main();
//setInterval(function(){ console.log(renderer.xr.isPresenting); },150);