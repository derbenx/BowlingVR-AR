import {
    BoxGeometry,
    BufferGeometry,
    Float32BufferAttribute,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    Quaternion,
    Vector3
} from 'three';

class XRPlanes extends Object3D {
    constructor(renderer) {
        super();
        this.xr = renderer.xr;
        this.planes = new Map();
        this.planeMaterial = new MeshBasicMaterial({
            color: 0xffff00,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.25
        });

        this.xr.addEventListener('planeschanged', (event) => {
            const frame = event.frame;
            const detectedPlanes = frame.detectedPlanes;

            const scenePlanes = new Set();

            for (const plane of detectedPlanes) {
                scenePlanes.add(plane);

                if (!this.planes.has(plane)) {
                    const planeMesh = this.createPlaneMesh(plane);
                    this.planes.set(plane, planeMesh);
                    this.add(planeMesh);
                }

                const planeMesh = this.planes.get(plane);
                this.updatePlaneMesh(planeMesh, plane);
            }

            for (const [plane, planeMesh] of this.planes) {
                if (!scenePlanes.has(plane)) {
                    this.remove(planeMesh);
                    this.planes.delete(plane);
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