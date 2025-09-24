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

        this.material = new MeshBasicMaterial({
            color: 0xffff00,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.25
        });

    }

    update(frame) {

        const referenceSpace = this.xr.getReferenceSpace();
        const session = this.xr.getSession();

        if (session.detectedPlanes) {

            const detectedPlanes = session.detectedPlanes;

            const scenePlanes = new Set();

            for (const plane of detectedPlanes) {

                scenePlanes.add(plane);

                if (!this.planes.has(plane)) {

                    const pose = frame.getPose(plane.planeSpace, referenceSpace);
                    const geometry = new BufferGeometry();

                    const vertices = new Float32BufferAttribute(plane.polygon, 3);
                    geometry.setAttribute('position', vertices);

                    const mesh = new Mesh(geometry, this.material);
                    mesh.matrix.fromArray(pose.transform.matrix);
                    mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
                    mesh.userData.xrPlane = plane;

                    this.planes.set(plane, mesh);
                    this.add(mesh);
                }
            }

            for (const [plane, mesh] of this.planes) {
                if (!scenePlanes.has(plane)) {
                    this.remove(mesh);
                    this.planes.delete(plane);
                }
            }
        }
    }
}

export { XRPlanes };