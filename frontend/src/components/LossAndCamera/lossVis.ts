import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls';
import { useRouteLoaderData } from '@modern-js/runtime/router';
import * as cameraVis from './cameraVis';
import * as pointVis from './pointVis';
import * as mockCameraData from './mockCameraData';
import * as mockPointData from './mockPointData';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  cameraVis.DEFAULT_FOV,
  1,
  0.01,
  1000,
);

const thumbnail = new Image();

let backup;

function clearScene(scene: THREE.Scene) {
  if (backup === undefined) {
    backup = scene.clone(true);
  }
  scene.clear();
}

function restoreScene(scene: THREE.Scene) {
  scene.copy(backup, true);
  backup = undefined;
}

function genFrameImgSrcString(frame) {
  return `data:image/${frame.image.format};base64,${frame.image.data}`;
}

export function updateLossVis(
  pointData,
  cameraData,
  canvasRef: HTMLCanvasElement,
) {
  if (pointData === undefined) {
    console.warn('updateLossVis: no point data');
    return;
  }
  if (!cameraData || cameraData.length === 0) {
    console.warn('updateLossVis: no camera data');
    return;
  }
  if (!canvasRef || !canvasRef.offsetWidth) {
    console.warn('updateLossVis: canvas not ready');
    return;
  }
  if (cameraData.length > 0) {
    // const thumbnail = <img src={genFrameImgSrcString(frames[0])} />;
    const { width, height } = thumbnail;
    const widthRatio = width / canvasRef.offsetWidth;
    const heightRatio = height / canvasRef.offsetHeight;
    const scale = widthRatio / heightRatio;

    clearScene(scene);
    pointVis.addPointsToScene(scene, pointData, (1 / scale) * pointData.ratio);
    // pointVis.addPointsToScene(scene, pointData, pointData.ratio, false);
    cameraData.ratio = pointData.ratio;
    // cameraVis.addCameraPointsToScene(
    //   scene,
    //   cameraData,
    //   (1 / scale) * pointData.ratio,
    // );
  }
}

export function initLossVis(
  pointData,
  cameraData,
  animateFunction,
  bindLossSelectFunction,
  canvasRef: HTMLCanvasElement,
  gsplatControls: TrackballControls,
  gsplatCamera: THREE.Camera,
  getObject3DControls: () => TrackballControls | undefined,
  getObject3DCamera: () => THREE.Camera | undefined,
  minDistance,
  maxDistance,
) {
  const rendererParams = {
    canvas: canvasRef,
  };
  const renderer = new THREE.WebGLRenderer(rendererParams);

  let width = canvasRef.offsetWidth;
  let height = canvasRef.offsetHeight;

  renderer.setSize(width, height);
  renderer.setClearColor('#ffffff', 1);

  const controls: { curr: TrackballControls | null } = {
    curr: null,
  };

  if (cameraData.length > 0) {
    // const thumbnail = <img src={genFrameImgSrcString(frames[0])} />;
    thumbnail.src = genFrameImgSrcString(cameraData[0]);
    thumbnail.onload = () => {
      ({ width, height } = thumbnail);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      camera.position.set(0, 5, 0);
      const widthRatio = width / canvasRef.offsetWidth;
      const heightRatio = height / canvasRef.offsetHeight;

      const scale = widthRatio / heightRatio;

      clearScene(scene);
      pointVis.addPointsToScene(
        scene,
        pointData,
        (1 / scale) * pointData.ratio, // TODO: With dev HMR enabled, repeated renders may distort the scale.
      );
      cameraData.ratio = pointData.ratio;
      cameraVis.addCameraPointsToScene(
        scene,
        cameraData,
        (1 / scale) * pointData.ratio,
      );

      camera.up.set(1, 0, 0);
      controls.curr = new TrackballControls(camera, renderer.domElement);
      controls.curr.reset();
      controls.curr.rotateSpeed = 3.0;
      controls.curr.zoomSpeed = 10.0;
      controls.curr.target = new THREE.Vector3(0.1, 0, 0); // https://github.com/mrdoob/three.js/issues/10161
      const handleChange = () => {
        const { rotation } = camera;
        const target = controls.curr?.target;
        // const quaternion = new THREE.Quaternion();
        // quaternion.setFromEuler(rotation);
        // const direction = new THREE.Vector3(0, 0, 1);
        // direction.applyQuaternion(quaternion);
        // const distance = 4;
        // const position = new THREE.Vector3();
        // position.copy(direction).multiplyScalar(distance).add(target);
        // gsplatCamera.up.set(camera.up.x, camera.up.y, camera.up.z);
        // getObject3DCamera()?.up.set(camera.up.x, camera.up.y, camera.up.z);
        // gsplatCamera.position.set(
        //   camera.position.x,
        //   camera.position.y,
        //   camera.position.z,
        // );
        // getObject3DCamera()?.position.set(
        //   camera.position.x,
        //   camera.position.y,
        //   camera.position.z,
        // );
        // // gsplatCamera.setRotationFromQuaternion(camera.quaternion);
        // gsplatCamera.rotation.set(rotation.x, rotation.y, rotation.z);
        // getObject3DCamera()?.rotation.set(rotation.x, rotation.y, rotation.z);
        // gsplatCamera.quaternion.set(
        //   camera.quaternion.x,
        //   camera.quaternion.y,
        //   camera.quaternion.z,
        //   camera.quaternion.w,
        // );
        // getObject3DCamera()?.quaternion.set(
        //   camera.quaternion.x,
        //   camera.quaternion.y,
        //   camera.quaternion.z,
        //   camera.quaternion.w,
        // );
        // // gsplatCamera.lookAt(target);
        // gsplatControls?.update();
        // getObject3DControls()?.update();
      };
      controls.curr.addEventListener('change', handleChange);

      controls.curr.minDistance = minDistance;
      controls.curr.maxDistance = maxDistance;
      controls.curr.update();

      bindLossSelectFunction(renderer, camera, scene);

      animateFunction(renderer, controls.curr, camera, scene);
    };
  } else {
    console.error('no frames, cannot scale');
  }

  return {
    renderer,
    controls,
    camera,
    scene,
  };
}
