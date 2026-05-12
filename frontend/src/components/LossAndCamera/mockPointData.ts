import * as THREE from 'three';

export function genMockPointPositions(nPoints) {
  const vectors: any[] = [];
  for (let i = 0; i < nPoints; i++) {
    vectors.push({
      x: 2 * Math.random() - 1,
      y: 2 * Math.random() - 1,
      z: 2 * Math.random() - 1,
    });
  }
  return vectors;
}
