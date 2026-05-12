import * as THREE from 'three';
import { getThreeJsColorByRisk } from '../../../resources/colors';
// import { CRC32Nums } from './crc32';

const DEFAULT_RISK = 0.5;
const POINT_SIZE = 0.005;

function normalizeArray(array: number[]) {
  const max = Math.max(...array);
  const min = Math.min(...array);
  return array.map(v => (v - min) / (max - min));
}

export function createPointMaterial(
  risk, // float 0.0-1.0
) {
  const material = new THREE.PointsMaterial({
    color: getThreeJsColorByRisk(risk),
    size: POINT_SIZE,
  });
  return material;
}

/**
 * @param {THREE.Scene} scene
 * @param {{ cloud: Array<Array<{ position: number[], risk: number, idx: number }>>, ratio: number }} pointData
 * @param {number} scaleY
 */
export function addPointsToScene(
  scene: THREE.Scene,
  pointData: {
    cloud: Array<Array<{ position: number[]; risk: number; idx: number }>>;
    ratio: number;
  },
  scaleY: number,
) {
  /** @type {THREE.Vector3[][]} */
  const locations: THREE.Vector3[][] = [];
  /** @type {number[][]} */
  const indices: number[][] = [];
  /** @type {number[]} */
  const maxRisks: number[] = [];
  /** @type {THREE.PointsMaterial[]} */
  const riskMaterials: THREE.PointsMaterial[] = [];

  pointData.cloud.forEach(points => {
    if (points.length === 0) {
      return;
    }
    // const hash = CRC32Nums(points.map(p => p.idx));
    // locations.push(new THREE.Vector3(...point.position));
    // riskMaterials.push(createPointMaterial(point.risk));
    const pointLocations: THREE.Vector3[] = [];
    const pointRealIndices: number[] = [];
    let maxRisk = 0;
    points.forEach(point => {
      pointRealIndices.push(point.idx);
      pointLocations.push(new THREE.Vector3(...point.position));
      maxRisk = maxRisk < point.risk ? point.risk : maxRisk;
    });
    locations.push(pointLocations);
    indices.push(pointRealIndices);
    maxRisks.push(maxRisk);
  });

  normalizeArray(maxRisks).forEach(risk => {
    riskMaterials.push(createPointMaterial(risk));
  });

  const group = new THREE.Group();
  for (let i = 0; i < locations.length; i++) {
    const locationGroup = locations[i];
    const indexGroup = indices[i];
    const material = riskMaterials[i];
    const geometry = new THREE.BufferGeometry().setFromPoints(locationGroup);
    geometry.userData.indexGroup = indexGroup;
    geometry.userData.maxRisk = maxRisks[i];
    geometry.scale(1, scaleY * pointData.ratio, 1);
    const points = new THREE.Points(geometry, material);
    group.add(points);
  }
  scene.add(group);
}
