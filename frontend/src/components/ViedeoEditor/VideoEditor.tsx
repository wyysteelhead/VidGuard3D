import React, {
  MutableRefObject,
  Ref,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useParams } from '@modern-js/runtime/router';
import * as THREE from 'three';
import { genFrameImgSrcString } from '../FrameVisualization/SegmentsMenu';
import {
  getNewRisksByBase64PixelMasksAndCheckedFramesArray,
  getNewRisksByBase64PixelMasksAndCheckedFramesArrayAndSelectedCloudPoints,
  // getNewRisksByFrameMasks,
  getNewRisksByPixelBooleanMasksAndCheckedFramesArray,
} from '../../routes/[id]/page.data';
import { IconStop, IconPlay, IconClose, IconCheck } from '../icons';
import InfoTip from '../InfoTip';
import { InfoFrameMask } from '../InfoTip/infoContent';
import ViewHeading from '../ViewHeading';
import LoadingButton from '../LoadingButton';
import Spinner from '../spinners';
import { useStore } from '../../model';
import EditElement from '../FrameVisualization/Edit';
import {
  calcPixelCoverageFromPolygon,
  drawFrameToCanvas,
  getSelectedFrames,
  isPointInsidePolygon,
  isPointInPolygonVertex,
  mapFramesToImageSources,
  dragPolygonVertex,
  movePolygon,
  replaceElementsPastIndex,
  getInitialPolygon,
  calcFullFrameMaskPolygon,
  DEFAULT_FRAME_RATE,
  initFrame2DBooleanArray,
  compressBooleanMatrixToBase64,
  lerpPolygon,
  convertPolygonToImageCoordinates,
} from './canvasLogic';

const baseApiUrl = process.env.CONFIG.BACKEND_API_BASE_URL;
const YOYO_ANIMATION = false; // has a side effect of making the animation and mask drawing misaligned

export function replaceElementAtIndex(array, index: number, element) {
  return [...array.slice(0, index), element, ...array.slice(index + 1)];
}

function calcTimestampStringFromFrameIndex(
  frameIndex,
  framerate,
  isEndOfFrame = false,
) {
  // video timestamp
  let millisecondsElapsed = (frameIndex / framerate) * 1000;

  if (isEndOfFrame) {
    millisecondsElapsed += 1000 / framerate - 1;
  }

  const time = new Date(0);
  time.setMilliseconds(millisecondsElapsed);

  return time.toISOString().substr(14, 9);
}

function buildCheckedFramesStartEndTimeString(checkedFramesArray, framerate) {
  const startIndex = checkedFramesArray.findIndex(v => v === true);
  const endIndex = checkedFramesArray.findLastIndex(v => v === true);

  if (startIndex === -1 || endIndex === -1) {
    return `${calcTimestampStringFromFrameIndex(
      0,
      framerate,
    )} - ${calcTimestampStringFromFrameIndex(checkedFramesArray.length, framerate, true)}`;
  }

  return `${calcTimestampStringFromFrameIndex(
    startIndex,
    framerate,
  )} - ${calcTimestampStringFromFrameIndex(endIndex, framerate, true)}`;
}

const VideoEditor = ({
  frames,
  checkedFramesArray,
  frameMaskCallback,
  selectedPointsRef: selectedPoints,
}: {
  frames: any[];
  checkedFramesArray: boolean[];
  frameMaskCallback: (
    newRisks: { cloud_risk: number[]; cam_risk: number[] },
    isDeleteFrames: boolean,
    checkedFramesArray: boolean[],
  ) => void;
  selectedPointsRef: MutableRefObject<
    THREE.Mesh<
      THREE.BufferGeometry<THREE.NormalBufferAttributes>,
      THREE.PointsMaterial,
      THREE.Object3DEventMap
    >[]
  >;
}) => {
  const { id: projectId } = useParams();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasContext, setCanvasContext] =
    useState<CanvasRenderingContext2D | null>(null);
  const [imageSources, setImageSources] = useState<string[]>([]);
  const [videoResolution, setVideoResolution] = useState<{
    width: number | null;
    height: number | null;
  }>({
    width: null,
    height: null,
  });
  const setFrameWidth = useStore(state => state.setFrameWidth);
  const setFrameHeight = useStore(state => state.setFrameHeight);

  const [animateFrames, setAnimateFrames] = useState(false);
  const [editing, setEditing] = useState(false);
  const updateEditsForComparisons = useStore(
    state => state.updateEditsForComparisons,
  );

  const [maskOpacity, setMaskOpacity] = useState(100); // 0 fully transparent, 100 fully opaque
  const [selectedPolygonIndex, setSelectedPolygonIndex] = useState<number>(-1); // pos int = polygon index, none=-1
  const [maskPolygons, setMaskPolygons] = useState<
    { x: number; y: number }[][]
  >([]); // {x,y}[][]

  const [draggingState, setDraggingState] = useState<number | null>(null); // null for not dragging, >0 int refer to vertex index, -1 for move polygon
  const [movePreviousX, setMovePreviousX] = useState<number>(0);
  const [movePreviousY, setMovePreviousY] = useState<number>(0);

  const [isMaskingLoading, setIsMaskingLoading] = useState(false);
  const [isFrameDeleteLoading, setIsFrameDeleteLoading] = useState(false);

  useEffect(() => {
    // i.e. value other than null or undefined
    if (canvasRef?.current) {
      const ctx = canvasRef.current.getContext('2d');

      if (!ctx) {
        return;
      }

      setCanvasContext(ctx);

      const dpi = window.devicePixelRatio;
      const styleHeight = Number(
        getComputedStyle(ctx.canvas).getPropertyValue('height').slice(0, -2),
      );
      const styleWidth = Number(
        getComputedStyle(ctx.canvas).getPropertyValue('width').slice(0, -2),
      );
      ctx.canvas.setAttribute('height', `${styleHeight * dpi}`);
      ctx.canvas.setAttribute('width', `${styleWidth * dpi}`);
    }
  }, [canvasRef]);

  useEffect(() => {
    if (!frames || frames.length === 0) {
      return;
    }

    const img = new Image();

    img.onload = function () {
      setVideoResolution({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
  setFrameWidth(img.naturalWidth);
  setFrameHeight(img.naturalHeight);
    };

    img.src = genFrameImgSrcString(frames[0]);
  }, [frames]);

  useEffect(() => {
    if (!frames || frames.length === 0) {
      return;
    }

    const imageSources = mapFramesToImageSources(
      getSelectedFrames(frames, checkedFramesArray),
    );

    setImageSources(imageSources);
  }, [frames, checkedFramesArray]);

  useEffect(() => {
    let frameCount = 0;
    let animationFrameId;

    if (imageSources.length === 0) {
      return window.cancelAnimationFrame(animationFrameId);
    }

    const images: string[] = [];
    if (animateFrames) {
      if (YOYO_ANIMATION) {
        images.push(...[...imageSources, ...imageSources.reverse()]);
      } else {
        images.push(...imageSources);
      }
    } else if (selectedPolygonIndex === -1) {
      images.push(imageSources[0]);
    } else {
      const maskProgress = selectedPolygonIndex / (maskPolygons.length - 1); // 0 for first mask, 1 for last mask, 0.X for a mask in between
      const imageSourceIndexToShow = (imageSources.length - 1) * maskProgress;
      images.push(imageSources[imageSourceIndexToShow]);
    }

    // Check if null context has been replaced on component mount
    if (canvasContext) {
      const render = () => {
        frameCount++;

        if (frameCount > imageSources.length - 1) {
          setAnimateFrames(false);
        }

        drawFrameToCanvas(
          canvasContext,
          images,
          videoResolution,
          maskPolygons,
          selectedPolygonIndex,
          maskOpacity,
          editing,
          animateFrames,
          frameCount,
        );
        animationFrameId = window.requestAnimationFrame(render);
      };
      render();
    }
    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [
    canvasContext,
    imageSources,
    videoResolution,
    maskPolygons,
    selectedPolygonIndex,
    editing,
    animateFrames,
    maskOpacity,
  ]);

  const handleMouseDown = event => {
    if (!canvasContext) {
      return;
    }

    if (editing) {
      const rect = canvasContext.canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) * window.devicePixelRatio;
      const y = (event.clientY - rect.top) * window.devicePixelRatio;
      const vertexCheck =
        maskPolygons.length > 0 && selectedPolygonIndex > -1
          ? isPointInPolygonVertex(x, y, maskPolygons[selectedPolygonIndex])
          : null;

      if (vertexCheck !== null) {
        if (
          event.ctrlKey &&
          selectedPolygonIndex === 0 &&
          maskPolygons[0].length > 3
        ) {
          // delete vertice
          setMaskPolygons(
            replaceElementAtIndex(
              maskPolygons,
              0,
              maskPolygons[0].filter((_, i) => i !== vertexCheck),
            ),
          );
        } else {
          // dragging vertice
          setDraggingState(vertexCheck);
        }
      } else if (
        maskPolygons.length > 0 &&
        selectedPolygonIndex > -1 &&
        isPointInsidePolygon(x, y, maskPolygons[selectedPolygonIndex])
      ) {
        // moving mask
        setDraggingState(-1);
        setMovePreviousX(x);
        setMovePreviousY(y);
      } else if (selectedPolygonIndex === 0) {
        // add new vertex
        setMaskPolygons(
          replaceElementAtIndex(maskPolygons, 0, [
            ...maskPolygons[0],
            { x, y },
          ]),
        );
      }
    }
  };

  const handleMouseMove = event => {
    if (!canvasContext) {
      return;
    }

    const rect = canvasContext.canvas?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const x = (event.clientX - rect.left) * window.devicePixelRatio;
    const y = (event.clientY - rect.top) * window.devicePixelRatio;

    if (draggingState !== null) {
      if (draggingState === -1) {
        // moving mask
        const newSelectedPolygon = movePolygon(
          x - movePreviousX,
          y - movePreviousY,
          maskPolygons[selectedPolygonIndex],
        );
        setMovePreviousX(x);
        setMovePreviousY(y);
        setMaskPolygons(
          replaceElementAtIndex(
            maskPolygons,
            selectedPolygonIndex,
            newSelectedPolygon,
          ),
        );
      } else {
        // dragging vertex
        const newSelectedPolygon = dragPolygonVertex(
          x,
          y,
          maskPolygons,
          selectedPolygonIndex,
          draggingState,
        );
        setMaskPolygons(
          replaceElementAtIndex(
            maskPolygons,
            selectedPolygonIndex,
            newSelectedPolygon,
          ),
        );
      }
    }

    if (draggingState !== null && draggingState >= 0) {
      // dragging vertex
      canvasContext.canvas.style.cursor = 'grabbing';
    } else if (
      maskPolygons.length > 0 &&
      selectedPolygonIndex > -1 &&
      isPointInPolygonVertex(x, y, maskPolygons[selectedPolygonIndex]) !== null
    ) {
      // hover over vertex (not dragging)
      canvasContext.canvas.style.cursor = 'grab';
    } else if (
      maskPolygons.length > 0 &&
      selectedPolygonIndex > -1 &&
      isPointInsidePolygon(x, y, maskPolygons[selectedPolygonIndex])
    ) {
      canvasContext.canvas.style.cursor = 'move';
    } else if (selectedPolygonIndex === 0) {
      // hover outside start polygon (add new vertex)
      canvasContext.canvas.style.cursor = 'crosshair';
    } else {
      // hover outside end polygon (cannot add new vertex)
      canvasContext.canvas.style.cursor = 'not-allowed';
    }
  };

  const handleMouseUp = event => {
    if (!canvasContext) {
      return;
    }

    const rect = canvasContext.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * window.devicePixelRatio;
    const y = (event.clientY - rect.top) * window.devicePixelRatio;

    if (draggingState !== null) {
      if (draggingState === -1) {
        // moving mask
        const newSelectedPolygon = movePolygon(
          x - movePreviousX,
          y - movePreviousY,
          maskPolygons[selectedPolygonIndex],
        );
        setMaskPolygons(
          replaceElementAtIndex(
            maskPolygons,
            selectedPolygonIndex,
            newSelectedPolygon,
          ),
        );
        setMovePreviousX(0);
        setMovePreviousY(0);
      } else {
        // dragging vertex
        const newSelectedPolygon = dragPolygonVertex(
          x,
          y,
          maskPolygons,
          selectedPolygonIndex,
          draggingState,
        );
        setMaskPolygons(
          replaceElementAtIndex(
            maskPolygons,
            selectedPolygonIndex,
            newSelectedPolygon,
          ),
        );
      }
    }

    if (selectedPolygonIndex === 0) {
      setMaskPolygons(
        replaceElementsPastIndex(
          maskPolygons,
          selectedPolygonIndex,
          maskPolygons[selectedPolygonIndex],
        ),
      );
    }
    setDraggingState(null);
  };

  const handleEditClick = () => {
    if (!canvasContext) {
      return;
    }

    const initialPolygon = getInitialPolygon(
      canvasContext.canvas.width,
      canvasContext.canvas.height,
    );
    setMaskPolygons([[...initialPolygon], [...initialPolygon]]);
    setSelectedPolygonIndex(0);

    setEditing(true);
    setDraggingState(null);
  };

  const handleFullMaskClick = async () => {
    setEditing(false);
    setIsFrameDeleteLoading(true);

    const frameWidth = videoResolution?.width || 0;

    const fullMaskPolygon = calcFullFrameMaskPolygon(
      canvasContext,
      videoResolution,
    );
    setMaskPolygons([[...fullMaskPolygon], [...fullMaskPolygon]]);

    const allTrueFrameBooleanMask: boolean[][] = initFrame2DBooleanArray(
      videoResolution?.width || 0,
      videoResolution.height || 0,
      true,
    );
    const allFalseFrameBooleanMask = initFrame2DBooleanArray(
      videoResolution.width || 0,
      videoResolution.height || 0,
      false,
    );

    const frameBooleanMasks: boolean[][][] = [...checkedFramesArray].map(
      isChecked => {
        // arrays are copied here to save memory
        return isChecked
          ? [...allTrueFrameBooleanMask]
          : [...allFalseFrameBooleanMask];
      },
    );

    const compressedMasks = frameBooleanMasks.map(mask => {
      return compressBooleanMatrixToBase64(mask);
    });

    const selectedIndices = new Set();
    for (const point of selectedPoints.current) {
      point.geometry.userData.indexGroup?.forEach(index => {
        selectedIndices.add(index);
      });
    }

    frameMaskCallback(
      await getNewRisksByBase64PixelMasksAndCheckedFramesArrayAndSelectedCloudPoints(
        projectId || '',
        compressedMasks,
        frameWidth,
        checkedFramesArray,
        Array.from(selectedIndices.values()) as number[],
      )
        .then(data => {
          if (data) {
            const startIndex = checkedFramesArray.findIndex(
              frame => frame === true,
            );
            const endIndex = checkedFramesArray.lastIndexOf(true);
            updateEditsForComparisons(oldArray => [
              ...oldArray,
                new EditElement(
                Date.now(),
                'delete',
                startIndex,
                endIndex,
                data.cam_risk.slice(startIndex, endIndex + 1),
                // store polygons as two polygons (start and end) in canvas coords
                [[...fullMaskPolygon], [...fullMaskPolygon]],
                '',
              ),
            ]);
            return data;
          }
        })
        .finally(() => {
          setIsFrameDeleteLoading(false);
        }),
      true, // identify this callback as full mask
      checkedFramesArray,
    );
  };

  const handleSubmitClick = async () => {
    setEditing(false);
    setDraggingState(null);
    setIsMaskingLoading(true);

    const allFalseFrameBooleanMask: boolean[][] = initFrame2DBooleanArray(
      videoResolution?.width || 0,
      videoResolution?.height || 0,
      false,
    );

    const nCheckedFrames = checkedFramesArray.filter(
      isChecked => isChecked,
    ).length;
    let checkedFramesCount = 0;

    const frameBooleanMasks = checkedFramesArray.map(isChecked => {
      if (!isChecked) {
        return [...allFalseFrameBooleanMask];
      }

      const maskProgress: number = checkedFramesCount / (nCheckedFrames - 1);
      checkedFramesCount += 1;

      return calcPixelCoverageFromPolygon(
        canvasContext,
        videoResolution,
        lerpPolygon(maskPolygons[0], maskPolygons[1], maskProgress),
      );
    });

    const compressedMasks = frameBooleanMasks.map(mask => {
      return compressBooleanMatrixToBase64(mask);
    });

    const selectedIndices = new Set();
    for (const point of selectedPoints.current) {
      point.geometry.userData.indexGroup?.forEach(index => {
        selectedIndices.add(index);
      });
    }

    frameMaskCallback(
      await getNewRisksByBase64PixelMasksAndCheckedFramesArrayAndSelectedCloudPoints(
        projectId || '',
        compressedMasks,
        videoResolution?.width || 0,
        checkedFramesArray,
        Array.from(selectedIndices.values()) as number[],
      )
        .then(data => {
          if (data) {
            const startIndex = checkedFramesArray.findIndex(
              frame => frame === true,
            );
            const endIndex = checkedFramesArray.lastIndexOf(true);
            updateEditsForComparisons(oldArray => [
              ...oldArray,
              new EditElement(
                Date.now(),
                'mask',
                startIndex,
                endIndex,
                data.cam_risk.slice(startIndex, endIndex + 1),
                // save polygons used to generate masks (start and end)
                // Convert polygons into original image coordinates.
                [
                  maskPolygons[0] && canvasContext && videoResolution.width && videoResolution.height 
                    ? convertPolygonToImageCoordinates(maskPolygons[0], canvasContext, { width: videoResolution.width, height: videoResolution.height })
                    : null,
                  maskPolygons[1] && canvasContext && videoResolution.width && videoResolution.height 
                    ? convertPolygonToImageCoordinates(maskPolygons[1], canvasContext, { width: videoResolution.width, height: videoResolution.height })
                    : null,
                ],
                '',
              ),
            ]);
            return data;
          }
        })
        .finally(() => {
          setIsMaskingLoading(false);
        }),
      false,
      checkedFramesArray,
    );
  };

  const handleCancelClick = () => {
    setEditing(false);
    setDraggingState(0);
    setSelectedPolygonIndex(-1);
    setMaskPolygons([]);
  };

  // const handleMaskOpacityChange = event => {
  //   setMaskOpacity(event.target.value);
  // };

  const handlePlayPauseAnimation = event => {
    setAnimateFrames(!animateFrames);
  };

  return (
    <div className="flex flex-col h-full bg-white p-4 rounded-xl">
      <ViewHeading>
        Plan formulation{' '}
        <InfoTip>
          <InfoFrameMask />
        </InfoTip>
      </ViewHeading>
      <div className="relative flex-1 flex flex-col justify-center items-center border border-secondary">
        <canvas
          className="w-full h-full"
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        ></canvas>
        {(!frames || frames.length === 0) && (
          <p className="absolute inset-1/2 flex flex-row justify-center items-center text-gray-400 fill-gray-900 gap-4">
            Loading...
            <Spinner />
          </p>
        )}
      </div>
      <div className="flex flex-col items-center mt-2 gap-2">
        <button
          className={`flex flex-row justify-center items-center shadow-md rounded-xl text-black text-lg w-full py-2 px-4 space-x-4 ${
            animateFrames
              ? 'bg-gray-400 hover:bg-gray-500'
              : 'bg-primary hover:bg-primary-dark'
          }`}
          onClick={handlePlayPauseAnimation}
          title={`${animateFrames ? 'Stop' : 'Play'} animation`}
        >
          {(buildCheckedFramesStartEndTimeString(
            checkedFramesArray,
            DEFAULT_FRAME_RATE,
          ) !== '' && (
            <>
              {(animateFrames && <IconStop />) || <IconPlay />}
              <span className="">
                {buildCheckedFramesStartEndTimeString(
                  checkedFramesArray,
                  DEFAULT_FRAME_RATE,
                )}
              </span>
            </>
          )) || (buildCheckedFramesStartEndTimeString(
            checkedFramesArray,
            DEFAULT_FRAME_RATE,
          ) !== '' && (
            <>
              {(animateFrames && <IconStop />) || <IconPlay />}
              <span className="">
                {buildCheckedFramesStartEndTimeString(
                  checkedFramesArray,
                  DEFAULT_FRAME_RATE,
                )}
              </span>
            </>
          ))}
        </button>
        <div className="flex flex-row justify-center items-center w-full gap-2">
          {editing ? (
            <>
              {maskPolygons.map((_, i) => {
                return (
                  <button
                    key={i}
                    className="flex-1 py-2 px-4 text-gray-400 outline -outline-offset-2 outline-gray-400 hover:outline-gray-500 aria-selected:bg-gray-400 aria-selected:text-black text-xl uppercase shadow-md rounded-xl"
                    onClick={() => {
                      setSelectedPolygonIndex(i);
                    }}
                    aria-selected={selectedPolygonIndex === i}
                    title={`Select mask ${i + 1}`}
                  >
                    M{i + 1}
                  </button>
                );
              })}
              {/* TODO: add mask opacity */}
              {/* <div className='py-2 px-2 flex items-center gap-1 bg-gray-400 text-lg uppercase shadow-md rounded-xl'>
                <span className='text-2xl' style={{ opacity: maskOpacity / 100 }}>
                  <IconGhost />
                </span>
                <label
                  htmlFor='mask-opacity-input'
                  className='sr-only'
                >
                  Mask opacity
                </label>
                <input
                  type='number'
                  className='bg-transparent text-center'
                  id='mask-opacity-input'
                  name='mask-opacity-input'
                  title='Mask opacity'
                  min='0'
                  max='100'
                  step='5'
                  value={maskOpacity}
                  onChange={handleMaskOpacityChange}
                />
              </div> */}
              <button
                className="py-2 px-2 h-full bg-gray-400 hover:bg-gray-500 text-2xl uppercase shadow-md rounded-xl text-black"
                onClick={handleCancelClick}
                title="Cancel mask drawing"
              >
                <IconClose />
              </button>
              <button
                className="py-2 px-2 h-full bg-primary hover:bg-primary-dark text-2xl uppercase shadow-md rounded-xl text-black disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleSubmitClick}
                title="Submit mask"
              >
                <IconCheck />
              </button>
            </>
          ) : (
            <>
              <LoadingButton
                className="flex-1 py-2 px-4 bg-gray-400 hover:bg-gray-500 text-xl uppercase shadow-md rounded-xl text-black"
                onClick={handleFullMaskClick}
                isLoading={isFrameDeleteLoading}
                title="Delete frames"
              >
                Delete&nbsp;frames
              </LoadingButton>
              <LoadingButton
                className="flex-1 py-2 px-4 bg-primary hover:bg-primary-dark text-xl uppercase shadow-md rounded-xl text-black"
                onClick={handleEditClick}
                isLoading={isMaskingLoading}
                title="Add mask"
              >
                Add&nbsp;mask
              </LoadingButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoEditor;
