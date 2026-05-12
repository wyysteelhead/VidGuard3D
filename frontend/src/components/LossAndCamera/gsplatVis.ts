import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls';
import { SceneFormat } from '@mkkellogg/gaussian-splats-3d';

const baseApiUrl = process.env.CONFIG.BACKEND_API_BASE_URL;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.01, 1000);

export function initGsplatVis(
  gsplatData,
  animateFunction,
  canvasRef: HTMLCanvasElement,
  minDistance,
  maxDistance,
) {
  const rendererParams = {
    canvas: canvasRef,
  };
  const renderer = new THREE.WebGLRenderer(rendererParams);

  camera.aspect = canvasRef.offsetWidth / canvasRef.offsetHeight;
  camera.updateProjectionMatrix();
  camera.position.set(0, 5, 0);

  renderer.setSize(canvasRef.offsetWidth, canvasRef.offsetHeight);
  renderer.setClearColor('#ffffff', 1);

  const viewer = new GaussianSplats3D.Viewer({
    renderer,
    threeScene: scene,
    camera,
    sharedMemoryForWorkers: false,
    gpuAcceleratedSort: false,
    cameraUp: camera.up,
    useBuiltInControls: true,
  });

  viewer
    .addSplatScene(`${baseApiUrl}${gsplatData.url}`, {
      streamView: true,
    })
    .then(() => {
      // const scale =
      //   Number(
      //     // eslint-disable-next-line no-alert
      //     prompt('Enter scale ratio of the attack simulation object', '1.5'),
      //   ) || 1.5;
      // viewer.threeScene.scale.set(scale, scale, scale);
      viewer.start();
    });

  const controls = new TrackballControls(camera, renderer.domElement);
  controls.target = new THREE.Vector3(0.01, 0, 0); // https://github.com/mrdoob/three.js/issues/10161
  // controls.enableRotate = false;
  controls.noRotate = false;
  controls.minDistance = minDistance;
  controls.maxDistance = maxDistance;
  // @ts-ignore
  controls.enableZoom = true;
  controls.update();

  animateFunction(renderer, controls, camera, scene, viewer);

  return {
    renderer,
    controls,
    camera,
  };
}
