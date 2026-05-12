import {
  useEffect,
  useRef,
  MutableRefObject,
  useState,
  useCallback,
  ChangeEvent,
} from 'react';
import { useDebounce, useWhyDidYouUpdate } from 'ahooks';
import { useRouteLoaderData, useParams, useNavigate } from '@modern-js/runtime/router';

import * as THREE from 'three';
import { Button, Switch, Slider } from 'antd';
import { ExpandOutlined } from '@ant-design/icons';

import { SelectionBox } from 'three/examples/jsm/interactive/SelectionBox';
import { SelectionHelper } from 'three/examples/jsm/interactive/SelectionHelper';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls';

import ViewHeading, { ViewSubHeading } from '../ViewHeading';

import {
  getColorByRisk,
  getThreeJsColorByRisk,
  getThreeJsColorSelection,
} from '../../../resources/colors';
import { IconMove, IconRectangleSelect, IconRefresh } from '../icons';
import Spinner from '../spinners';
import ControlPannel from '../ControlPannel';
import { getRisksOfSelectedPoints } from '../../routes/[id]/page.data';
import {
  resetCloudRisks,
  updateCloudRisks,
  updateCloudRisksRange,
} from '../../routes/[id]/page';
import { InfoGaussianSplat, InfoPointCloud } from '../InfoTip/infoContent';
import InfoTip from '../InfoTip';
import LoadingButton from '../LoadingButton';
import MeshViewer from '../MeshViewer/MeshViewer';
import { Frame, useStore } from '../../model';
import { createPointMaterial } from './pointVis';
import { initGsplatVis } from './gsplatVis';
import { genMockPointPositions } from './mockPointData';
import { initLossVis, updateLossVis } from './lossVis';

import './index.less';

let lossRenderer: THREE.WebGLRenderer | null = null;
let lossControls: null | { curr: TrackballControls | null } = null;
let gsplatRenderer: THREE.WebGLRenderer | null = null;
let gsplatControls: TrackballControls | null = null;

const original3DController: { curr: TrackballControls | null } = { curr: null };
const original3DCamera: { curr: THREE.Camera | null } = { curr: null };

/**
 * @param {
    {
      cloud: Promise<{ cloud: Array<Array<{ position: number[], risk: number, idx: number }>>, ratio: number }>;
      registerSetLossRisks: (cloudRisks: {
          position: number[];
          risk: number;
          idx: number;
        }[][], camRisks: {
          risk: number;
        }[]) => void;
      selectedPointsRef: MutableRefObject<
        THREE.Mesh<
          THREE.BufferGeometry<THREE.NormalBufferAttributes>,
          THREE.Material | THREE.Material[],
          THREE.Object3DEventMap,
        >[],
  >
    }
  } param0
 * @returns
 */
const LossAndCamera = ({
  cloud,
  frames,
  heatmapFrames,
  setHeatmapFrames,
  selectedPointsRef: selectedPoints,
  registerSetLossRisks,
  fullscreenMode = false,
}: {
  cloud: Promise<{
    cloud: Array<
      Array<{
        position: number[];
        risk: number;
        idx: number;
        similarity: number;
        backupRisk?: number | undefined;
      }>
    >;
    ratio: number;
  }>;
  // registerSetLossRisks: (
  //   cloudRisks: {
  //     position: number[];
  //     risk: number;
  //     idx: number;
  //   }[][],
  //   camRisks?: {
  //     risk: number;
  //   }[],
  // ) => void;
  registerSetLossRisks: (...args: any[]) => void;
  selectedPointsRef: MutableRefObject<
    THREE.Mesh<
      THREE.BufferGeometry<THREE.NormalBufferAttributes>,
      THREE.PointsMaterial,
      THREE.Object3DEventMap
    >[]
  >;
  frames: Frame[];
  heatmapFrames: Frame[];
  setHeatmapFrames: (frames: any[] | ((frames: any[]) => void)) => void;
  fullscreenMode?: boolean;
}) => {
  useWhyDidYouUpdate('LossAndCamera', {
    cloud,
    frames,
    heatmapFrames,
  });
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  original3DController.curr = useStore(state => state.original3DController);
  original3DCamera.curr = useStore(state => state.original3DCamera);

  const checkRef = useRef(false);
  const lossCanvasRef = useRef<HTMLCanvasElement>();
  const gsplatCanvasRef = useRef<HTMLCanvasElement>();

  const lossCamera = useRef<THREE.PerspectiveCamera | undefined>();
  const lossScene = useRef<THREE.Scene | undefined>();

  const { gsplat: gsplatData } = useRouteLoaderData('[id]/page') as any;

  const minDistance = 0.1;
  const maxDistance = 10;
  const setOriginalRisk = useStore(state => state.setOriginalRisk);
  const setSelectedIndices = useStore(state => state.setSelectedIndices);
  const storedSelectedIndices = useStore(state => state.selectedIndices);

  const deepRef = useRef(maxDistance);

  const enableRotate = useRef(true);
  if (lossControls?.curr) {
    lossControls.curr.noRotate = !enableRotate.current;
  }

  /**
   * @type {MutableRefObject<{
    cloud: {
        position: number[];
        risk: number;
        idx: number;
    }[][];
    ratio: number;
  }>}
   */
  const pointsData: MutableRefObject<
    | {
        cloud: {
          position: number[];
          risk: number;
          idx: number;
          backupRisk?: number;
          similarity: number;
        }[][];
        ratio: number;
      }
    | undefined
  > = useRef();

  /** @type {SelectionBox | null} */
  let selectionBox: SelectionBox | null = null;

  const onSwitchChange = (ev: ChangeEvent) => {
    const { checked } = ev.target as HTMLInputElement;
    enableRotate.current = !checked;
    // lossControls.curr.enableRotate = enableRotate.current;
    if (!lossControls?.curr) {
      throw new Error('lossControls is not initialized');
    }
    lossControls.curr.noRotate = !enableRotate.current;
    checkRef.current = checked;
  };

  const bindLossSelect = (renderer, camera, scene) => {
    const helper = new SelectionHelper(renderer, 'selectBox');
    selectionBox = new SelectionBox(camera, scene, deepRef.current);

    let isSelecting = false;
    let isCancelSelecting = false;
    let isMultiSelecting = false;

    window.addEventListener('keydown', function (event) {
      if (event.key === 'z' || event.key === 'Z') {
        isCancelSelecting = true;
      } else if (event.altKey === true) {
        isMultiSelecting = true;
      }
    });

    window.addEventListener('keyup', function (event) {
      if (event.key === 'z' || event.key === 'Z') {
        isCancelSelecting = false;
      } else if (event.altKey === false) {
        isMultiSelecting = false;
      }
    });

    function onMouseDown(event: MouseEvent) {
      if (checkRef.current === true) {
        isSelecting = true;
      }
      if (!checkRef.current) {
        helper.enabled = false;
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = (-(event.clientY - rect.top) / rect.height) * 2 + 1;
      helper.startPoint.set(event.clientX, event.clientY);
      helper.enabled = true;

      if (isCancelSelecting) {
        selectionBox?.startPoint.set(x, y, 0.5);
      } else if (isMultiSelecting) {
        // multiSelectionBox = new SelectionBox(camera, scene, deepRef.current);
        selectionBox?.startPoint.set(x, y, 0.5);
      } else {
        // // eslint-disable-next-line no-alert
        // const confirmCancel = confirm(
        //   'Are you sure you want to cancel selection?',
        // );
        // if (!confirmCancel) {
        //   return;
        // }
        for (const item of selectedPoints.current) {
          if (item.material instanceof THREE.PointsMaterial) {
            item.material.color.set(
              getThreeJsColorByRisk(item.geometry.userData.maxRisk),
            );
          }
        }
        selectionBox?.startPoint.set(x, y, 0.5);
      }
    }

    function onMouseUp(event) {
      if (!checkRef.current || !isSelecting) {
        return;
      }
      isSelecting = false;

      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = (-(event.clientY - rect.top) / rect.height) * 2 + 1;
      if (isCancelSelecting) {
        selectionBox?.endPoint.set(x, y, 0.5);
        const allCanceledSelected = selectionBox
          ?.select()
          .filter(
            mesh => mesh.material instanceof THREE.PointsMaterial,
          ) as THREE.Mesh<
          THREE.BufferGeometry<THREE.NormalBufferAttributes>,
          THREE.PointsMaterial,
          THREE.Object3DEventMap
        >[];
        for (let i = 0; i < allCanceledSelected.length; i++) {
          allCanceledSelected[i].material.color.set(
            getThreeJsColorByRisk(
              allCanceledSelected[i].geometry.userData.maxRisk,
            ),
          );
        }
        selectedPoints.current = selectedPoints.current.filter(
          selectedPoint =>
            !allCanceledSelected.map(v => v.id).includes(selectedPoint.id),
        );
      } else if (isMultiSelecting) {
        selectionBox?.endPoint.set(x, y, 0.5);
        const multiSelected = selectionBox
          ?.select()
          .filter(
            mesh => mesh.material instanceof THREE.PointsMaterial,
          ) as THREE.Mesh<
          THREE.BufferGeometry<THREE.NormalBufferAttributes>,
          THREE.PointsMaterial,
          THREE.Object3DEventMap
        >[];
        const allSelected = selectedPoints.current;
        const intersection = allSelected.filter(v =>
          multiSelected?.map(a => a.id).includes(v.id),
        );
        for (let i = 0; i < allSelected.length; i++) {
          allSelected[i].material.color.set(
            getThreeJsColorByRisk(allSelected[i].geometry.userData.maxRisk),
          );
        }
        for (let i = 0; i < multiSelected.length; i++) {
          multiSelected[i].material.color.set(getThreeJsColorSelection());
        }
        for (let i = 0; i < intersection.length; i++) {
          intersection[i].material.color.set(getThreeJsColorSelection());
        }
        selectedPoints.current = intersection;
      } else {
        // for (let i = 0; i < selectionBox?.collection.length; i++) {
        //   if (
        //     selectionBox?.collection[i].material instanceof THREE.PointsMaterial
        //   ) {
        //     selectionBox?.collection[i].material.color.set();
        //   }
        // }
        selectionBox?.endPoint.set(x, y, 0.5);
        const allSelected = selectionBox
          ?.select()
          .filter(
            mesh => mesh.material instanceof THREE.PointsMaterial,
          ) as THREE.Mesh<
          THREE.BufferGeometry<THREE.NormalBufferAttributes>,
          THREE.PointsMaterial,
          THREE.Object3DEventMap
        >[];
        for (let i = 0; i < allSelected.length; i++) {
          allSelected[i].material.color.set(getThreeJsColorSelection());
        }
        selectedPoints.current = allSelected;
      }
    }

    function onMouseMove(event) {
      if (!checkRef.current || !isSelecting) {
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = (-(event.clientY - rect.top) / rect.height) * 2 + 1;

      if (helper.isDown) {
        if (isCancelSelecting) {
          selectionBox?.endPoint.set(x, y, 0.5);
          const allCanceledSelected = selectionBox
            ?.select()
            .filter(
              mesh => mesh.material instanceof THREE.PointsMaterial,
            ) as THREE.Mesh<
            THREE.BufferGeometry<THREE.NormalBufferAttributes>,
            THREE.PointsMaterial,
            THREE.Object3DEventMap
          >[];
          for (let i = 0; i < allCanceledSelected.length; i++) {
            allCanceledSelected[i].material.color.set(
              getThreeJsColorByRisk(
                allCanceledSelected[i].geometry.userData.maxRisk,
              ),
            );
          }
        } else if (isMultiSelecting) {
          selectionBox?.endPoint.set(x, y, 0.5);
          const multiSelected = selectionBox
            ?.select()
            .filter(
              mesh => mesh.material instanceof THREE.PointsMaterial,
            ) as THREE.Mesh<
            THREE.BufferGeometry<THREE.NormalBufferAttributes>,
            THREE.PointsMaterial,
            THREE.Object3DEventMap
          >[];
          for (let i = 0; i < multiSelected.length; i++) {
            multiSelected[i].material.color.set(getThreeJsColorSelection());
          }
        } else {
          for (let i = 0; i < selectionBox!.collection.length; i++) {
            if (
              selectionBox?.collection[i].material instanceof
              THREE.PointsMaterial
            ) {
              (
                selectionBox?.collection[i].material as THREE.MeshBasicMaterial
              ).color.set(
                getThreeJsColorByRisk(
                  selectionBox?.collection[i].geometry.userData.maxRisk,
                ),
              );
            }
          }
          selectionBox?.endPoint.set(x, y, 0.5);
          const allSelected = selectionBox
            ?.select()
            .filter(
              mesh => mesh.material instanceof THREE.PointsMaterial,
            ) as THREE.Mesh<
            THREE.BufferGeometry<THREE.NormalBufferAttributes>,
            THREE.PointsMaterial,
            THREE.Object3DEventMap
          >[];
          for (const selected of allSelected) {
            selected.material.color.set(getThreeJsColorSelection());
          }
        }
      }
    }

    renderer.domElement.addEventListener('pointerdown', onMouseDown, false);
    renderer.domElement.addEventListener('pointerup', onMouseUp, false);
    renderer.domElement.addEventListener('pointermove', onMouseMove, false);
  };

  const clearSelect = () => {
    (
      selectionBox?.collection.filter(
        mesh => mesh.material instanceof THREE.PointsMaterial,
      ) as THREE.Mesh<
        THREE.BufferGeometry<THREE.NormalBufferAttributes>,
        THREE.PointsMaterial,
        THREE.Object3DEventMap
      >[]
    ).forEach(v =>
      v.material.color.set(getThreeJsColorByRisk(v.geometry.userData.maxRisk)),
    );
    if (selectionBox?.collection) {
      selectionBox.collection = [];
    }
  };

  const onDeepChange = value => {
    clearSelect();
    deepRef.current = value;
    selectionBox = new SelectionBox(
      lossCamera.current as THREE.Camera,
      lossScene.current as THREE.Scene,
      value,
    );
  };

  const _riskRange = useStore(state => state.riskRange);
  const _setRiskRange = useStore(state => state.setRiskRange);
  const [riskRange, setRiskRange] = useState(_riskRange);
  const debouncedRiskRange = useDebounce(riskRange, {
    wait: 50,
  });

  useEffect(() => {
    _setRiskRange(debouncedRiskRange);
  }, [debouncedRiskRange]);

  const debounceRiskRangeChange = useCallback(
    (values: number[]) => {
      if (values.length !== 2) {
        console.error('debounceRiskRangeChange: values length is not 2');
      } else {
        setRiskRange(values as [number, number]);
      }
    },
    [riskRange],
  );

  useEffect(() => {
    if (!pointsData.current) {
      if (cloud instanceof Promise) {
        cloud.then(data => {
          pointsData.current = data;
          updateCloudRisksRange(
            debouncedRiskRange[0],
            debouncedRiskRange[1],
            // @ts-ignore
            pointsData.current,
          );
          updateLoss();
        });
      }
    } else {
      updateCloudRisksRange(
        debouncedRiskRange[0],
        debouncedRiskRange[1],
        // @ts-ignore
        pointsData.current,
      );
      updateLoss();
    }
  }, [debouncedRiskRange]);

  const animate = (renderer, controls, camera: THREE.Camera, scene, viewer) => {
    requestAnimationFrame(() =>
      animate(renderer, controls, camera, scene, viewer),
    );
    controls.update();
    renderer.render(scene, camera);
  };

  /**
   * @type {MutableRefObject<{ camera: THREE.Camera } | undefined>}
   */
  const gsplatVis: MutableRefObject<
    | {
        camera: THREE.Camera;
        renderer: THREE.WebGLRenderer;
        controls: TrackballControls;
      }
    | undefined
  > = useRef();

  useEffect(() => {
    async function initLossAndGsplat() {
      if (pointsData.current === undefined) {
        if (gsplatVis.current === undefined) {
          gsplatVis.current = initGsplatVis(
            await gsplatData,
            animate,
            gsplatCanvasRef.current!,
            minDistance,
            maxDistance,
          );
        }
        pointsData.current = await cloud;
      }

      if (pointsData.current !== undefined) {
        gsplatRenderer = gsplatVis.current!.renderer;
        gsplatControls = gsplatVis.current!.controls;

        // Ensure the canvas ref is available before initializing the loss view.
        if (!lossCanvasRef.current) {
          console.warn('lossCanvasRef not ready, skipping initLossVis');
          return;
        }

        const lossVis = initLossVis(
          pointsData.current,
          frames,
          animate,
          bindLossSelect,
          lossCanvasRef.current,
          gsplatControls,
          gsplatVis.current!.camera,
          () => original3DController.curr!,
          () => original3DCamera.curr!,
          minDistance,
          maxDistance,
        );

        lossRenderer = lossVis.renderer;
        lossControls = lossVis.controls;
        lossCamera.current = lossVis.camera;
        lossScene.current = lossVis.scene;
      }
    }
    if (!process.env.CONFIG.DISABLE_CLOUD_AND_GSPLAT) {
      initLossAndGsplat();
    }

    return () => {
      lossControls?.curr?.dispose();
      lossRenderer?.dispose();
      gsplatControls?.dispose();
      gsplatRenderer?.dispose();
    };
  }, [frames]);

  function restoreRisk() {
    resetCloudRisks(pointsData.current);
    setHeatmapFrames(frames);
    setOriginalRisk(structuredClone(frames));
    updateLoss();
  }

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [chamferMetrics, setChamferMetrics] = useState<{ [key: string]: number | string } | null>(null);

  const fetchInitialChamferMetrics = async () => {
    try {
      // 初始化时只获取全局chamfer metrics（GET请求）
      const response = await fetch(`${process.env.CONFIG.BACKEND_API_BASE_URL}data/${projectId}/chamfer_metrics`);
      
      if (response.ok) {
        const metrics = await response.json();
        setChamferMetrics(metrics);
      } else {
        setChamferMetrics({ error: '⚠️' });
      }
    } catch (error) {
      console.error('Failed to fetch initial chamfer metrics:', error);
      setChamferMetrics({ error: '⚠️' });
    }
  };

  useEffect(() => {
    if (projectId) {
      fetchInitialChamferMetrics();
    }
  }, [projectId]);

  async function analyzeRisk() {
    setIsAnalyzing(true);
    const selectedIndices = new Set();
    for (const point of selectedPoints.current) {
      point.geometry.userData.indexGroup?.forEach(index => {
        selectedIndices.add(index);
      });
    }

    const selectedIndicesArray = Array.from(selectedIndices.values());

    const result = await getRisksOfSelectedPoints(
      projectId,
      selectedIndicesArray,
    );

    const { cam_risk: camRisk, cloud_risk: cloudRisk, chamfer_metrics } = result ?? {};

    setIsAnalyzing(false);

    if (frames.length !== camRisk.length) {
      console.error('frames and camRisk length mismatch');
    }

    updateCloudRisks(cloudRisk, pointsData.current!, true);

    const newFrames = frames.map((frame, index) => {
      return {
        ...frame,
        risk: camRisk[index],
      };
    });

    setHeatmapFrames(newFrames);
    setOriginalRisk(structuredClone(newFrames));

    updateLoss();
    
    // 如果返回了chamfer_metrics，直接更新
    if (chamfer_metrics) {
      setChamferMetrics(chamfer_metrics);
    }
  }

  function updateLoss() {
    updateLossVis(pointsData.current, heatmapFrames, lossCanvasRef.current!);
  }

  /**
   *
   * @param {{
       position: number[];
       risk: number;
       idx: number;
     }[][]} cloudRisks
   * @param {Frame[]} camRisks
   */
  function setLossRisks(
    cloudRisks: {
      position: number[];
      risk: number;
      idx: number;
    }[][],
    camRisks: any[],
  ) {
    if (cloudRisks === undefined || camRisks === undefined) {
      console.error('setLossRisks: cloudRisks or camRisks is undefined');
      return;
    }
    for (let i = 0; i < cloudRisks.length; i++) {
      for (let j = 0; j < cloudRisks[i].length; j++) {
        if (pointsData.current!.cloud[i][j].idx !== cloudRisks[i][j].idx) {
          console.error('setLossRisks: cloudRisks and pointsData mismatch');
        }
        if (pointsData.current!.cloud[i][j].backupRisk !== undefined) {
          delete pointsData.current!.cloud[i][j].backupRisk;
        }
        pointsData.current!.cloud[i][j].risk = cloudRisks[i][j].risk;
      }
    }

    setHeatmapFrames((heatmapFrames: any[]) => {
      return heatmapFrames.map((frame, index) => {
        return {
          ...frame,
          risk: camRisks[index],
        } satisfies Frame;
      });
    });
    setRiskRange([0, 1]);
  }

  useEffect(() => {
    registerSetLossRisks(setLossRisks);
  }, []);

  useEffect(() => {
    updateLoss();
  }, [heatmapFrames]);

  // 恢复三维选择状态
  useEffect(() => {
    if (storedSelectedIndices.length > 0 && lossScene.current && pointsData.current) {
      // 清除当前选择的视觉状态
      for (const mesh of selectedPoints.current) {
        if (mesh.material instanceof THREE.PointsMaterial) {
          mesh.material.color.set(
            getThreeJsColorByRisk(mesh.geometry.userData.maxRisk),
          );
        }
      }
      selectedPoints.current = [];
      
      // 创建一个selectedIndices的Set用于快速查找
      const selectedSet = new Set(storedSelectedIndices);
      
      // 遍历scene中的所有mesh，找到包含指定索引的mesh
      lossScene.current.traverse((object) => {
        if (object instanceof THREE.Mesh && object.material instanceof THREE.PointsMaterial) {
          const indexGroup = object.geometry.userData.indexGroup;
          if (indexGroup && indexGroup.some(idx => selectedSet.has(idx))) {
              // Find meshes that contain selected indices, then add them to the selection and update the color.
            selectedPoints.current.push(object);
            object.material.color.set(getThreeJsColorSelection());
          }
        }
      });

        // Automatically re-run risk analysis after restoring the selection.
      if (selectedPoints.current.length > 0) {
        analyzeRisk();
      }
    }
  }, [storedSelectedIndices, lossScene]);


  return (
    <>
      <div className="flex-1 col-span-6 flex flex-col bg-white rounded-xl p-4">
        {!fullscreenMode && <ViewHeading className="mt-1">3D Asset Exploration</ViewHeading>}
        <div className={`flex-1 ${fullscreenMode ? 'flex' : 'grid grid-cols-8'} gap-4`}>
          <div className={`${fullscreenMode ? 'flex-1' : 'col-span-3'} flex flex-col gap-4`}>
            {!fullscreenMode && <MeshViewer className="flex flex-col flex-1" />}
            <div className="flex flex-col flex-1">
              <div className="flex justify-between items-center mb-2">
                <ViewSubHeading>
                  Attack simulation{' '}
                  <InfoTip>
                    <InfoGaussianSplat />
                  </InfoTip>
                </ViewSubHeading>
                {!fullscreenMode && (
                  <Button 
                    type="text" 
                    size="small"
                    icon={<ExpandOutlined />}
                    onClick={() => {
                      navigate(`/${projectId}/attack`);
                    }}
                    title="全屏模式"
                  />
                )}
              </div>
              <div className="flex-1">
                <canvas
                  className="w-full h-full border border-secondary-200"
                  ref={gsplatCanvasRef as MutableRefObject<HTMLCanvasElement>}
                ></canvas>
              </div>
            </div>
          </div>
          {!fullscreenMode && <div className="col-span-5 flex-1 flex flex-col">
            <div className="flex justify-between items-center mb-2">
              <ViewSubHeading>
                Risk estimation{' '}
                <InfoTip>
                  <InfoPointCloud />
                </InfoTip>
              </ViewSubHeading>
              {chamferMetrics && (
                <div className="relative group">
                  <div className={`px-3 py-1 rounded-lg text-sm cursor-help ${
                    chamferMetrics.error 
                      ? 'bg-gray-100'
                      : (() => {
                          const mean = chamferMetrics.chamfer_distance_mean;
                          if (typeof mean === 'number' && mean < 0.002) return 'bg-red-100 text-red-800';
                          if (typeof mean === 'number' && mean < 0.01) return 'bg-orange-100 text-orange-800';
                          if (typeof mean === 'number' && mean < 0.05) return 'bg-yellow-100 text-yellow-800';
                          return 'bg-green-100 text-green-800';
                        })()
                  }`}>
                    <span className="text-gray-600">Risk Level:</span>
                    <span className="ml-2 font-semibold">
                      {chamferMetrics.error || 
                       (() => {
                         const mean = chamferMetrics.chamfer_distance_mean;
                         if (mean === undefined) return 'N/A';
                         if (typeof mean === 'number' && mean < 0.002) return 'Critical';
                         if (typeof mean === 'number' && mean < 0.01) return 'High';
                         if (typeof mean === 'number' && mean < 0.05) return 'Moderate';
                         return 'Low';
                       })()}
                    </span>
                  </div>
                  {!chamferMetrics.error && (
                    <div className="absolute top-full right-0 mt-2 p-3 bg-black text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50 max-w-xs">
                      {Object.entries(chamferMetrics)
                        .map(([key, value]) => (
                          <div key={key} className={key === 'chamfer_distance_mean' ? 'font-bold' : ''}>
                            {key}: {typeof value === 'number' ? value.toFixed(4) : value}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="relative flex flex-col flex-1">
              <canvas
                className="static w-full h-full border border-secondary-200"
                ref={lossCanvasRef as MutableRefObject<HTMLCanvasElement>}
              ></canvas>

              <label
                className="group absolute top-2 right-2 cursor-pointer flex flex-row p-1 shadow-md rounded-full gap-2 text-3xl bg-gray-300 bg-opacity-50 hover:bg-opacity-90"
                htmlFor="rotateOrSelect"
                title="Toggle between rotate and select mode"
              >
                <input
                  id="rotateOrSelect"
                  onChange={onSwitchChange}
                  type="checkbox"
                  className="hidden peer"
                  defaultChecked={checkRef.current}
                />
                <span
                  className={`text-white bg-primary peer-checked:text-gray-300 peer-checked:bg-gray-100 rounded-full p-1 transition-colors duration-300`}
                >
                  <IconMove />
                </span>
                <span
                  className={`text-gray-300 bg-gray-100 peer-checked:text-white peer-checked:bg-primary rounded-full p-1 transition-colors duration-300`}
                >
                  <IconRectangleSelect />
                </span>
              </label>
              {pointsData.current === undefined && (
                <p className="absolute inset-1/2 flex flex-row justify-center items-center text-gray-400 fill-gray-900 gap-4">
                  Loading...
                  <Spinner />
                </p>
              )}
              <div className="static flex w-full gap-2 items-center">
                <span className="w-2/5 text-xl text-gray-400 uppercase">
                  estimation range:
                </span>
                <button
                  className="w-1/5 py-2 text-xl text-black uppercase shadow-md rounded-xl bg-primary hover:bg-primary-dark"
                  onClick={restoreRisk}
                >
                  Clear
                </button>
                <LoadingButton
                  className="w-2/5 py-2 text-xl text-black uppercase shadow-md rounded-xl bg-primary hover:bg-primary-dark"
                  onClick={analyzeRisk}
                  isLoading={isAnalyzing}
                >
                  Submit selection
                </LoadingButton>
              </div>
              <div className="static flex flex-row items-center gap-4 max-h-[40px]">
                {/* <div className="grid grid-cols-3 justify-center items-center gap-2">
                <span className="text-right">rotate</span>
                <Switch className="bg-gray-200" onChange={onSwitchChange} />
                <span>select</span>
              </div> */}
                <div className="flex w-full my-2 max-h-[40px] items-center -mb-3">
                  <span className="w-2/5 text-xl text-gray-400 uppercase">
                    risk color mapping:
                  </span>
                  <Slider
                    className="w-3/5"
                    range
                    min={0}
                    max={1}
                    value={debouncedRiskRange}
                    step={0.01}
                    onChange={debounceRiskRangeChange}
                    styles={{
                      track: {
                        background: `linear-gradient(to right, ${getColorByRisk(
                          0,
                        )}, ${getColorByRisk(1)})`,
                      },
                    }}
                    marks={{ 0: '0', 1: '1' }}
                  />
                </div>
                {/* <div className="flex flex-col flex-1">
              <span className="text-center text-sm -mb-3">selection depth</span>
              <Slider
                max={maxDistance}
                min={minDistance}
                step={0.1}
                defaultValue={maxDistance}
                onChangeComplete={onDeepChange}
              />
            </div> */}
              </div>
              {/* TODO: inputs below look a lot better but needs to be linked up to logic */}
              {/* <div className="flex flex-row items-center mt-2 mb-2 gap-4">
            <div className="flex flex-col bg-gray-200 p-2 rounded-full">
              <label className="inline-flex items-center cursor-pointer">
                <span className="me-1 text-sm font-medium text-gray-900">
                  view
                </span>
                <input
                  type="checkbox"
                  onChange={onSwitchChange}
                  className="sr-only peer"
                />
                <div className="relative w-11 h-6 bg-gray-500 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:w-5 after:h-5 after:transition-all peer-checked:bg-primary"></div>
                <span className="ms-1 text-sm font-medium text-gray-900">
                  select
                </span>
              </label>
            </div>
            <div className="flex flex-col flex-1">
              <span className="text-sm text-center font-medium text-gray-900 -mb-4">
                selection depth
              </span>
              <Slider
                max={maxDistance}
                min={minDistance}
                step={0.1}
                defaultValue={maxDistance}
                onChangeComplete={onDeepChange}
              />
            </div>
          </div>
          <button
            className="flex-1 py-1 shadow-md rounded-xl text-white bg-primary hover:bg-primary-dark"
            onClick={analyzeRisk}
          >
            Analyze
          </button> */}
            </div>
          </div>}
        </div>
      </div>
    </>
  );
};

export default LossAndCamera;
