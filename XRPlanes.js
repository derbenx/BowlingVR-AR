import {
    BoxGeometry,
    BufferGeometry,
    Float32BufferAttribute,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    Quaternion,
    Vector3,
    EventDispatcher
} from 'three';

class XRPlanes extends EventDispatcher {
    constructor(renderer) {
        super();
        this.visible = false;
        this.xr = renderer.xr;
        this.planes = new Map();
        this.planeMaterial = new MeshBasicMaterial({
            color: 0xffff00,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.25
        });

        this.floorFound = false;

        this.xr.addEventListener('planeschanged', (event) => {
            if (this.floorFound) return;

            const frame = event.frame;
            const detectedPlanes = frame.detectedPlanes;

            for (const plane of detectedPlanes) {
                if (plane.orientation === 'horizontal') {
                    const pose = frame.getPose(plane.planeSpace, this.xr.getReferenceSpace());
                    if (pose) {
                        this.dispatchEvent({ type: 'floor-found', data: { y: pose.transform.position.y } });
                        this.floorFound = true;
                        return;
                    }
                }
            }
        });
    }

    createPlaneMesh(plane) {
        const planeGeometry = new BufferGeometry();
        const planeMesh = new Mesh(planeGeometry, this.planeMaterial);
        planeMesh.userData.xrPlane = plane;
        return planeMesh;
    }

    updatePlaneMesh(mesh, plane) {
        const pose = this.xr.getFrame().getPose(plane.planeSpace, this.xr.getReferenceSpace());
        if (pose) {
            mesh.matrix.fromArray(pose.transform.matrix);
            mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
        }

        const polygon = plane.polygon;
        if (polygon && polygon.length > 0) {
            const positions = new Float32Array(polygon.length * 3);
            for (let i = 0; i < polygon.length; ++i) {
                positions[i * 3] = polygon[i].x;
                positions[i * 3 + 1] = polygon[i].y;
                positions[i * 3 + 2] = polygon[i].z;
            }
            mesh.geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        }
    }
}

export { XRPlanes };