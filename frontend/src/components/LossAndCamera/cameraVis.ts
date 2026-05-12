// generate camera positions, directions, fovs, risk factors
import * as THREE from 'three';
import {
  getThreeJsColorDeleted,
  getThreeJsColorByRisk,
} from '../../../resources/colors';

const DEFAULT_ASPECT = 16 / 9;
export const DEFAULT_FOV = 75;
const DEFAULT_RISK = 0.5;
const CAMERA_SCALE = 0.1;

function calculateHeightOfCameraGeometry(fov, aspect) {
  // Convert the vertex angle from degrees to radians
  const angleInRadians = fov * (Math.PI / 180);
  // Calculate the height
  return Math.tan(angleInRadians / 2) * (aspect / 2);
}

export function createCameraGeometry(
  fov = DEFAULT_FOV,
  aspect = DEFAULT_ASPECT,
) {
  const height = calculateHeightOfCameraGeometry(fov, aspect);

  const points = [
    new THREE.Vector3(0, 0, 0), // point of pyramid
    new THREE.Vector3( // southwest
      (-aspect / 2) * CAMERA_SCALE,
      -0.5 * CAMERA_SCALE,
      height * CAMERA_SCALE,
    ),
    new THREE.Vector3( // northwest
      (-aspect / 2) * CAMERA_SCALE,
      0.5 * CAMERA_SCALE,
      height * CAMERA_SCALE,
    ),
    new THREE.Vector3( // northeast
      (aspect / 2) * CAMERA_SCALE,
      0.5 * CAMERA_SCALE,
      height * CAMERA_SCALE,
    ),
    new THREE.Vector3( // southeast
      (aspect / 2) * CAMERA_SCALE,
      -0.5 * CAMERA_SCALE,
      height * CAMERA_SCALE,
    ),
  ];

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  geometry.setIndex([
    0,
    1,
    2, // West
    0,
    2,
    3, // North
    0,
    1,
    4, // South
    0,
    3,
    4, // East
    2,
    1,
    4, // base
    3,
    2,
    4, // base
  ]);
  return geometry;
}

export function createCameraMaterial(
  risk, // float 0.0-1.0
  isDeleted: boolean,
) {
  const material = new THREE.MeshBasicMaterial({
    color: getThreeJsColorByRisk(risk),
    wireframe: true,
  });

  if (isDeleted) {
    material.color = getThreeJsColorDeleted();
  }

  return material;
}

export function addCameraPointsToScene(scene, cameraData, scaleY) {
  const group = new THREE.Group();
  cameraData.forEach(cam => {
    const geo = createCameraGeometry(cam.fovy, cam.aspect_ratio);
    geo.scale(1, scaleY * cameraData.ratio, 1);
    const mat = createCameraMaterial(cam.risk, Boolean(cam.isDeleted));
    const cameraObject = new THREE.Mesh(geo, mat);
    cameraObject.position.copy(new THREE.Vector3(...cam.location));
    cameraObject.lookAt(new THREE.Vector3(...cam.direction));
    group.add(cameraObject);
  });
  scene.add(group);
}
