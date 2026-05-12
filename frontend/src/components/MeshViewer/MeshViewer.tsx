import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls';
import InfoTip from '../InfoTip';
import { InfoMeshViewer } from '../InfoTip/infoContent';
import ViewHeading, { ViewSubHeading } from '../ViewHeading';
import { IconUpload } from '../icons';
import LoadingButton from '../LoadingButton';
import { useStore } from '../../model';

function MeshViewer({ ...props }) {
  const canvasRef = useRef<HTMLCanvasElement>();
  const fileInputRef = useRef<HTMLInputElement>();
  const [errorMessage, setErrorMessage] = useState('');
  const [object, setObject] =
    useState<THREE.Group<THREE.Object3DEventMap> | null>(null);
  const [hideControls, setHideControls] = useState(false);
  const scene = useRef(new THREE.Scene());
  // scene.current.translateY(-1);
  const setOriginal3DController = useStore(
    state => state.setOriginal3DController,
  );
  const setOriginal3DCamera = useStore(state => state.setOriginal3DCamera);
  const scale = useRef(2.5);

  const clearObject = () => {
    setObject(null);
    setErrorMessage('');
    if (fileInputRef) {
      fileInputRef.current!.files = null;
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) {
      setErrorMessage('No files selected');
      return;
    }

    let mtlFile;
    let objFile;
    let imgFile;
    Array.from(selectedFiles).forEach((file: File) => {
      if (file.name.endsWith('.mtl')) {
        mtlFile = file;
      } else if (file.name.endsWith('.obj')) {
        objFile = file;
      } else if (file.name.endsWith('.jpg') || file.name.endsWith('.png')) {
        imgFile = file;
      }
    });

    const missingFiles: string[] = [];
    if (!mtlFile) {
      missingFiles.push('mtl');
    }
    if (!objFile) {
      missingFiles.push('obj');
    }
    if (!imgFile) {
      missingFiles.push('jpg');
    }
    if (missingFiles.length > 0) {
      if (missingFiles.length === 1) {
        setErrorMessage(`Missing a .${missingFiles[0]} file`);
      } else if (missingFiles.length === 2) {
        setErrorMessage(
          `Missing .${missingFiles[0]} and .${missingFiles[1]} files`,
        );
      } else if (missingFiles.length === 3) {
        setErrorMessage(
          `Missing .${missingFiles[0]}, .${missingFiles[1]} and .${missingFiles[2]} files`,
        );
      }
      return;
    }

    const objReader = new FileReader();
    const mtlReader = new FileReader();
    const imgReader = new FileReader();

    try {
      imgReader.onload = () => {
        const image = new Image();
        image.src = imgReader.result as string;
        image.onload = () => {
          const texture = new THREE.Texture(image);
          texture.needsUpdate = true;

          mtlReader.onload = () => {
            const mtlLoader = new MTLLoader();
            // @ts-ignore
            const materials = mtlLoader.parse(mtlReader.result);
            materials.preload();
            (
              materials.materials[
                Object.keys(materials.materials)[0]
              ] as THREE.MeshBasicMaterial
            ).map = texture;
            objReader.onload = () => {
              const objLoader = new OBJLoader();
              objLoader.setMaterials(materials);
              // @ts-ignore
              const object = objLoader.parse(objReader.result);

              scale.current =
                Number(
                  // eslint-disable-next-line no-alert
                  prompt(
                    'Enter scale ratio of the rendered 3D asset object',
                    '2.5',
                  ),
                ) || 2.5;
              object.scale.set(scale.current, -scale.current, -scale.current);
              object.rotateY(-Math.PI / 3);
              // object.rotateY(Math.PI / 3);
              setObject(object);
            };
            objReader.readAsText(objFile);
          };
          mtlReader.readAsText(mtlFile);
        };
      };
      imgReader.readAsDataURL(imgFile);
    } catch (error: any) {
      console.error(error);
      setErrorMessage(error.message);
    }
    setErrorMessage('');
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return () => {
        setErrorMessage('Canvas element not initialised');
      };
    }

    const rendererParams = {
      canvas,
      antialias: true,
    };
    const renderer = new THREE.WebGLRenderer(rendererParams);
    renderer.setSize(
      Math.floor(canvas.offsetWidth),
      Math.floor(canvas.offsetHeight),
    );
    renderer.setClearColor('#ffffff', 1);

    scene.current.remove(...scene.current.children);
    const ambientLight = new THREE.AmbientLight(0xffffff, 2);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 0, 0);

    if (object) {
      scene.current.add(object);
      scene.current.add(ambientLight, directionalLight);
      setHideControls(true);
    } else {
      return () => {
        setErrorMessage('');
        setHideControls(false);
      };
    }

    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 2000);
    camera.position.set(0, 5, 0);
    // camera.position.setZ(2);

    const controls = new TrackballControls(camera, renderer.domElement);
    controls.reset();
    controls.rotateSpeed = 3.0;
    controls.zoomSpeed = 10.0;
    controls.target = new THREE.Vector3(0.1, -0.1, 0.1);
    setOriginal3DController(controls);
    setOriginal3DCamera(camera);

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene.current, camera);
    };
    animate();

    return () => {
      renderer.dispose();
    };
  }, [object, canvasRef]);

  return (
    <div className={props.className}>
      <ViewSubHeading className="mb-2">
        Original 3D asset{' '}
        <InfoTip>
          <InfoMeshViewer />
        </InfoTip>
      </ViewSubHeading>
      <div className="relative flex-1 border border-secondary-200">
        <canvas
          ref={canvasRef as React.MutableRefObject<HTMLCanvasElement>}
          className="w-full h-full"
        ></canvas>
        {!hideControls && (
          <div
            className={`absolute inset-4 flex flex-col justify-center items-center gap-2`}
          >
            <input
              id="files"
              ref={fileInputRef as React.MutableRefObject<HTMLInputElement>}
              className="hidden"
              type="file"
              accept=".obj,.mtl,.jpg,.png"
              multiple
              onChange={handleFileSelect}
            />
            <label
              className="py-2 w-1/2 text-center text-xl uppercase cursor-pointer shadow-md rounded-xl text-white bg-primary hover:bg-primary-dark"
              htmlFor="files"
            >
              Select files
            </label>
            <button
              className="py-2 w-1/2 text-xl uppercase shadow-md rounded-xl text-white bg-gray-400 hover:bg-gray-500"
              onClick={clearObject}
            >
              Clear
            </button>
            {errorMessage && (
              <p className="col-span-2 text-center text-lg text-red-800">
                {errorMessage}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default MeshViewer;
