import { getColorSelectionRgba } from '../../../resources/colors';
import { genFrameImgSrcString } from '../FrameVisualization/SegmentsMenu';

export const DEFAULT_FRAME_RATE = 15;
const DRAGGING_MOUSE_BUFFER = 5;

export function mapFramesToImageSources(
  frames: Array<{
    image: { format: string; data: string };
  }>,
) {
  const sources: string[] = [];
  frames.forEach(frame => {
    sources.push(genFrameImgSrcString(frame));
  });
  return sources;
}

function sleep(milliseconds = 1000) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function clearCanvas(context) {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
}

export function calcFrameDimensionsOnCanvas(context, videoResolution) {
  const { width: frameWidth, height: frameHeight } = videoResolution;
  const { width: canvasWidth, height: canvasHeight } = context.canvas;

  const canvasAspect = canvasWidth / canvasHeight;
  const frameAspect = frameWidth / frameHeight;

  let ratio = 0;
  let startX = 0;
  let startY = 0;
  if (frameAspect >= canvasAspect) {
    // letter-boxed
    ratio = canvasWidth / frameWidth;
    startY = canvasHeight / 2 - (frameHeight * ratio) / 2;
  } else {
    // blank on sides
    ratio = canvasHeight / frameHeight;
    startX = canvasWidth / 2 - (frameWidth * ratio) / 2;
  }

  return {
    startX,
    startY,
    width: frameWidth * ratio,
    height: frameHeight * ratio,
  };
}

export function calcMaskDimensionsOnFrame(context, videoResolution, selection) {
  const { width: frameWidth, height: frameHeight } = videoResolution;
  const { width: canvasWidth, height: canvasHeight } = context.canvas;

  const canvasAspect = canvasWidth / canvasHeight;
  const frameAspect = frameWidth / frameHeight;

  let ratio = 0;
  let frameStartX = 0;
  let frameStartY = 0;
  if (frameAspect >= canvasAspect) {
    // letter-boxed
    ratio = canvasWidth / frameWidth;
    frameStartY = canvasHeight / 2 - (frameHeight * ratio) / 2;
  } else {
    // blank on sides
    ratio = canvasHeight / frameHeight;
    frameStartX = canvasWidth / 2 - (frameWidth * ratio) / 2;
  }

  const { startX, startY, endX, endY } = selection;
  const frameMaskBounds = {
    sx: Math.round((startX - frameStartX) / ratio),
    sy: Math.round((startY - frameStartY) / ratio),
    ex: Math.round((endX - frameStartX) / ratio),
    ey: Math.round((endY - frameStartY) / ratio),
  };

  if (frameMaskBounds.sx < 0) {
    frameMaskBounds.sx = 0;
  }
  if (frameMaskBounds.sy < 0) {
    frameMaskBounds.sy = 0;
  }
  if (frameMaskBounds.ex > frameWidth) {
    frameMaskBounds.ex = frameWidth;
  }
  if (frameMaskBounds.ey > frameHeight) {
    frameMaskBounds.ey = frameHeight;
  }
  return frameMaskBounds;
}

export function calcFullFrameMaskPolygon(context, videoResolution) {
  const { width: frameWidth, height: frameHeight } = videoResolution;
  const { width: canvasWidth, height: canvasHeight } = context.canvas;

  const canvasAspect = canvasWidth / canvasHeight;
  const frameAspect = frameWidth / frameHeight;

  let ratio = 0;
  let startX = 0;
  let startY = 0;
  if (frameAspect >= canvasAspect) {
    // letter-boxed
    ratio = canvasWidth / frameWidth;
    startY = canvasHeight / 2 - (frameHeight * ratio) / 2;
  } else {
    // blank on sides
    ratio = canvasHeight / frameHeight;
    startX = canvasWidth / 2 - (frameWidth * ratio) / 2;
  }

  return [
    { x: startX, y: startY },
    { x: startX, y: frameHeight * ratio },
    { x: frameWidth * ratio, y: frameHeight * ratio },
    { x: frameWidth * ratio, y: startY },
  ];
}

export function calcPixelCoverageFromPolygon(
  context,
  videoResolution,
  polygon,
): boolean[][] {
  const { width: frameWidth, height: frameHeight } = videoResolution;
  const { width: canvasWidth, height: canvasHeight } = context.canvas;

  const canvasAspect = canvasWidth / canvasHeight;
  const frameAspect = frameWidth / frameHeight;

  let ratio = 0;
  let frameStartX = 0;
  let frameStartY = 0;
  if (frameAspect >= canvasAspect) {
    // letter-boxed
    ratio = canvasWidth / frameWidth;
    frameStartY = canvasHeight / 2 - (frameHeight * ratio) / 2;
  } else {
    // blank on sides
    ratio = canvasHeight / frameHeight;
    frameStartX = canvasWidth / 2 - (frameWidth * ratio) / 2;
  }

  const resizedPolygon = polygon.map(vertex => ({
    x: (vertex.x - frameStartX) / ratio,
    y: (vertex.y - frameStartY) / ratio,
  }));

  const frameBooleanMask = initFrame2DBooleanArray(
    frameWidth,
    frameHeight,
    false,
  );

  // create 2d array full of true
  const pixelBooleanMask = frameBooleanMask.map((col, colIndex) => {
    return col.map((row, rowIndex) => {
      // use nonzero winding rule to determine if the point is inside the polygon
      return isPointInsidePolygon(rowIndex, colIndex, resizedPolygon);
    });
  });

  return pixelBooleanMask;
}

export function initFrame2DBooleanArray(
  frameWidth: number,
  frameHeight: number,
  fillValue = false,
): boolean[][] {
  const out: boolean[][] = [];
  for (let r = 0; r < frameHeight; r++) {
    out.push(new Array(frameWidth).fill(fillValue));
  }
  return out;
}

/**
 * Converts a polygon from canvas coordinates into original image coordinates.
 * @param polygon Polygon defined in canvas coordinates.
 * @param canvasContext Active canvas context.
 * @param videoResolution Original image resolution.
 * @returns Converted polygon in original image coordinates.
 */
export function convertPolygonToImageCoordinates(
  polygon: { x: number; y: number }[],
  canvasContext: CanvasRenderingContext2D,
  videoResolution: { width: number; height: number }
): { x: number; y: number }[] {
  const { width: frameWidth, height: frameHeight } = videoResolution;
  const { width: canvasWidth, height: canvasHeight } = canvasContext.canvas;

  const canvasAspect = canvasWidth / canvasHeight;
  const frameAspect = frameWidth / frameHeight;

  let ratio = 0;
  let frameStartX = 0;
  let frameStartY = 0;
  if (frameAspect >= canvasAspect) {
    // letter-boxed
    ratio = canvasWidth / frameWidth;
    frameStartY = canvasHeight / 2 - (frameHeight * ratio) / 2;
  } else {
    // blank on sides
    ratio = canvasHeight / frameHeight;
    frameStartX = canvasWidth / 2 - (frameWidth * ratio) / 2;
  }

  // Convert canvas coordinates back into original image coordinates.
  return polygon.map(vertex => ({
    x: (vertex.x - frameStartX) / ratio,
    y: (vertex.y - frameStartY) / ratio,
  }));
}

/**
 * Builds a boolean mask directly from a polygon in original image coordinates.
 * @param polygon Polygon in original image coordinates.
 * @param frameWidth Image width.
 * @param frameHeight Image height.
 * @returns Boolean mask matrix.
 */
export function createBooleanMaskFromImagePolygon(
  polygon: { x: number; y: number }[],
  frameWidth: number,
  frameHeight: number
): boolean[][] {
  const frameBooleanMask = initFrame2DBooleanArray(
    frameWidth,
    frameHeight,
    false,
  );

  // Use the polygon directly in original image coordinates.
  const pixelBooleanMask = frameBooleanMask.map((col, colIndex) => {
    return col.map((row, rowIndex) => {
      // use nonzero winding rule to determine if the point is inside the polygon
      return isPointInsidePolygon(rowIndex, colIndex, polygon);
    });
  });

  return pixelBooleanMask;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function lerpPolygon(startPolygon, endPolygon, progress) {
  return startPolygon.map((startVertex, index: number) => {
    const endVertex = endPolygon[index];
    return {
      x: lerp(startVertex.x, endVertex.x, progress),
      y: lerp(startVertex.y, endVertex.y, progress),
    };
  });
}

function drawMasksOnCanvas(
  context,
  maskPolygons,
  selectedPolygonIndex,
  maskOpacity,
  editingStatus,
  isAnimating = false,
  animationProgress = 1, // 0 to 1
) {
  if (isAnimating) {
    drawMask(
      context,
      lerpPolygon(maskPolygons[0], maskPolygons[1], animationProgress),
      maskOpacity,
      false,
    );
  } else {
    for (const [index, polygon] of maskPolygons.entries()) {
      drawMask(
        context,
        polygon,
        index === selectedPolygonIndex ? 0.75 : 0.25,
        index === selectedPolygonIndex,
      );
    }
  }
}

function drawMask(
  context: CanvasRenderingContext2D,
  polygon: Point[],
  opacity: number,
  isSelected: boolean,
) {
  context.fillStyle = getColorSelectionRgba(opacity);

  context.beginPath();
  context.moveTo(polygon[0].x, polygon[0].y);
  for (let i = 1; i < polygon.length; i++) {
    context.lineTo(polygon[i].x, polygon[i].y);
  }
  context.closePath();
  context.fill();

  if (isSelected) {
    for (const point of polygon) {
      context.fillStyle = getColorSelectionRgba();
      context.fillRect(
        point.x - DRAGGING_MOUSE_BUFFER,
        point.y - DRAGGING_MOUSE_BUFFER,
        DRAGGING_MOUSE_BUFFER * 2,
        DRAGGING_MOUSE_BUFFER * 2,
      );
    }
  }
}

export function drawFrameToCanvas(
  context,
  imageSources,
  videoResolution,
  maskPolygons,
  selectedPolygonIndex,
  maskOpacity,
  editingStatus,
  isAnimating,
  frameCount,
  framerate = DEFAULT_FRAME_RATE,
) {
  const i = frameCount % imageSources.length;

  const img = new Image();

  img.src = imageSources[i];

  img.onload = () => {
    const { startX, startY, width, height } = calcFrameDimensionsOnCanvas(
      context,
      videoResolution,
    );

    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    context.drawImage(img, startX, startY, width, height);

    if (editingStatus) {
      drawMasksOnCanvas(
        context,
        maskPolygons,
        selectedPolygonIndex,
        maskOpacity,
        editingStatus,
        isAnimating,
        i / (imageSources.length - 1),
      );
    }
  };
}

export function getInitialPolygon(canvasWidth, canvasHeight) {
  // centered triangle
  return [
    { x: canvasWidth / 2, y: Number(canvasHeight) / 3 },
    { x: Number(canvasWidth) / 3, y: (canvasHeight * 2) / 3 },
    { x: (canvasWidth * 2) / 3, y: (canvasHeight * 2) / 3 },
  ];
}

export function replaceElementAtIndex<T>(
  array: T[],
  index: number,
  element: T,
) {
  return [...array.slice(0, index), element, ...array.slice(index + 1)];
}

/**
 * Replaces all elements past a given index in an array with a new element.
 *
 * @param {Array} array - The array to modify.
 * @param {number} index - The index at which to start replacing elements.
 * @param {*} replacementElement - The element to replace past the given index.
 * @return {Array} A new array with elements replaced past the given index.
 */
export function replaceElementsPastIndex<T>(
  array: T[][],
  index: number,
  replacementElement: T[],
): T[][] {
  return [
    ...array.slice(0, index + 1),
    ...Array(array.length - index - 1)
      .fill({})
      .map(() => {
        return [...replacementElement];
      }),
  ];
}

export function isPointInsidePolygon(x: number, y: number, polygon: Point[]) {
  // code below sourced from https://stackoverflow.com/a/17490923
  let isInside = false;
  let minX = polygon[0].x;
  let maxX = polygon[0].x;
  let minY = polygon[0].y;
  let maxY = polygon[0].y;
  for (let n = 1; n < polygon.length; n++) {
    const q = polygon[n];
    minX = Math.min(q.x, minX);
    maxX = Math.max(q.x, maxX);
    minY = Math.min(q.y, minY);
    maxY = Math.max(q.y, maxY);
  }

  if (x < minX || x > maxX || y < minY || y > maxY) {
    return false;
  }

  let i = 0;
  let j = polygon.length - 1;
  for (; i < polygon.length; j = i++) {
    if (
      polygon[i].y > y !== polygon[j].y > y &&
      x <
        ((polygon[j].x - polygon[i].x) * (y - polygon[i].y)) /
          (polygon[j].y - polygon[i].y) +
          polygon[i].x
    ) {
      isInside = !isInside;
    }
  }

  return isInside;
}

export function isPointInPolygonVertex(x: number, y: number, polygon: Point[]) {
  for (let i = 0; i < polygon.length; i++) {
    if (
      x > polygon[i].x - DRAGGING_MOUSE_BUFFER &&
      y > polygon[i].y - DRAGGING_MOUSE_BUFFER &&
      x < polygon[i].x + DRAGGING_MOUSE_BUFFER &&
      y < polygon[i].y + DRAGGING_MOUSE_BUFFER
    ) {
      return i;
    }
  }

  return null;
}

export interface Point {
  x: number;
  y: number;
}

export function movePolygon(dx: number, dy: number, polygonVertices: Point[]) {
  return polygonVertices.map(vertex => {
    return {
      x: vertex.x + dx,
      y: vertex.y + dy,
    };
  });
}

export function dragPolygonVertex(
  x,
  y,
  polygons,
  selectedPolygonIndex,
  draggingVertexIndex,
) {
  if (selectedPolygonIndex === null) {
    return null;
  }

  const newPolygon = polygons[selectedPolygonIndex];
  newPolygon[draggingVertexIndex] = {
    x,
    y,
  };
  return newPolygon;
}

export function adjustDraggingValue(
  currentDragging,
  setDraggingFunction,
  selection,
  dx,
  dy,
) {
  let newStartX = selection.startX;
  let newStartY = selection.startY;
  let newEndX = selection.endX;
  let newEndY = selection.endY;
  switch (currentDragging) {
    case 1:
      newStartX += dx;
      newStartY += dy;
      if (newStartX > newEndX && newStartY < newEndY) {
        setDraggingFunction(2);
      }
      if (newStartX < newEndX && newStartY > newEndY) {
        setDraggingFunction(3);
      }
      if (newStartX > newEndX && newStartY > newEndY) {
        setDraggingFunction(4);
      }
      break;
    case 2:
      newEndX += dx;
      newStartY += dy;
      if (newEndX < newStartX && newStartY < newEndY) {
        setDraggingFunction(1);
      }
      if (newEndX > newStartX && newStartY > newEndY) {
        setDraggingFunction(4);
      }
      if (newEndX < newStartX && newStartY > newEndY) {
        setDraggingFunction(3);
      }
      break;
    case 3:
      newStartX += dx;
      newEndY += dy;
      if (newStartX < newEndX && newEndY < newStartY) {
        setDraggingFunction(1);
      }
      if (newStartX > newEndX && newEndY > newStartY) {
        setDraggingFunction(4);
      }
      if (newStartX > newEndX && newEndY < newStartY) {
        setDraggingFunction(2);
      }
      break;
    case 4:
      newEndX += dx;
      newEndY += dy;
      if (newEndX < newStartX && newEndY < newStartY) {
        setDraggingFunction(1);
      }
      if (newEndX < newStartX && newEndY > newStartY) {
        setDraggingFunction(3);
      }
      if (newEndX > newStartX && newEndY < newStartY) {
        setDraggingFunction(2);
      }
      break;
    default:
      break;
  }
  return { newStartX, newStartY, newEndX, newEndY };
}

export function getSelectedFrames(frames, checkedFramesArray) {
  return frames.filter((value, index) => {
    return checkedFramesArray[index];
  });
}

export function calcCheckedFramesArrayByCheckedSegmentsArray(
  segments: number[],
  checkedSegmentsArray: boolean[],
  totalNumberOfFrames: number,
) {
  const newCheckedFramesArray = new Array(totalNumberOfFrames).fill(false);

  checkedSegmentsArray.forEach((value, index) => {
    if (value) {
      const startIndex = segments[index];
      const endIndex =
        segments[index] +
        calcLengthOfSegment(index, segments, totalNumberOfFrames);

      for (let i = startIndex; i < endIndex; i++) {
        newCheckedFramesArray[i] = true;
      }
    }
  });

  return newCheckedFramesArray;
}

export function calcLengthOfSegment(
  index: number,
  segments: number[],
  totalNumberOfFrames: number,
) {
  const endIndex = segments[index + 1]
    ? segments[index + 1]
    : totalNumberOfFrames;
  return endIndex - segments[index];
}

export function compressBooleanMatrixToBase64(matrix: boolean[][]) {
  const byteArray: number[] = [];
  let byte = 0;
  let bitCount = 0;

  matrix.forEach(row => {
    row.forEach(value => {
      byte = (byte << 1) | (value ? 1 : 0); // Pack boolean values into bits.
      bitCount++;

      if (bitCount === 8) {
        // Pack every 8 bits into one byte.
        byteArray.push(byte);
        byte = 0;
        bitCount = 0;
      }
    });
  });

  if (bitCount > 0) {
    // Pad and flush the remaining bits if fewer than 8 remain.
    byte <<= 8 - bitCount; // Left-pad the partial byte.
    byteArray.push(byte);
  }

  const arrayBufferToBase64 = (buffer: any) => {
    const uint8Array = new Uint8Array(buffer);
    const data = uint8Array.reduce(
      (acc, i) => (acc += String.fromCharCode.apply(null, [i])),
      ''
    );
    return data;
  };

  // Convert the byte array to a Base64 string.
  // const binaryString = String.fromCharCode.apply(null, byteArray);
  const binaryString = arrayBufferToBase64(byteArray);
  return btoa(binaryString); // Base64
}
