import { useEffect, useRef } from 'react';
import { IconWarning } from '../icons';
import { BarsSpinner } from '../spinners';
import {
  getPrimaryColor,
  getColorByRisk,
  getColorDeletedRgba,
} from '../../../resources/colors';
import FramesMenu from './FramesMenu';
import { calcSegmentEndFrameIndex } from '.';

const WINDOW_STROKE_THICKNESS = 4;

export function findTrueSequences(array) {
  const sequences: number[][] = [];
  let sequenceStart: number | null = null;

  for (let i = 0; i < array.length; i++) {
    if (array[i]) {
      if (sequenceStart === null) {
        sequenceStart = i; // Start of a new sequence
      }
    } else if (sequenceStart !== null) {
      sequences.push([sequenceStart, i - 1]); // End of a sequence
      sequenceStart = null;
    }
  }

  // Handle a sequence that might end the array
  if (sequenceStart !== null) {
    sequences.push([sequenceStart, array.length - 1]);
  }

  return sequences;
}

const calcFrameDimensions = (context, totalFrames) => {
  const frameWidth = context.canvas.width / totalFrames;
  const frameHeight = context.canvas.height;
  return { frameWidth, frameHeight };
};

const calcFramesGradient = (
  frames: { risk: number; isDeleted: boolean | undefined }[],
  context,
) => {
  const gradient = context.createLinearGradient(0, 0, context.canvas.width, 0);
  const inverseNumberOfFrames = 1 / frames.length;
  const halfInverseNumberOfFrames = inverseNumberOfFrames / 2;

  gradient.addColorStop(0, getColorByRisk(frames[0].risk));
  for (let i = 0; i < frames.length; i++) {
    gradient.addColorStop(
      inverseNumberOfFrames * i + halfInverseNumberOfFrames,
      frames[i].isDeleted
        ? getColorDeletedRgba()
        : getColorByRisk(frames[i].risk),
    );
  }
  gradient.addColorStop(1, getColorByRisk(frames[frames.length - 1].risk));
  return gradient;
};

const drawWindow = (context, startFrame, endFrame, totalFrames) => {
  const { frameWidth, frameHeight } = calcFrameDimensions(context, totalFrames);
  const startX = Math.max(
    Math.round(startFrame * frameWidth) - WINDOW_STROKE_THICKNESS / 2,
    WINDOW_STROKE_THICKNESS / 2,
  );
  const widthX =
    startX + (endFrame - startFrame + 1) * frameWidth < frameWidth * totalFrames
      ? Math.round((endFrame - startFrame + 1) * frameWidth)
      : frameWidth * totalFrames - WINDOW_STROKE_THICKNESS;

  context.lineWidth = WINDOW_STROKE_THICKNESS;
  context.strokeStyle = getPrimaryColor();
  context.strokeRect(
    startX,
    WINDOW_STROKE_THICKNESS / 2,
    widthX,
    frameHeight - WINDOW_STROKE_THICKNESS,
  );
};

const drawFrameRisks = (
  context: CanvasRenderingContext2D,
  frames: { risk: number; isDeleted: boolean | undefined }[],
) => {
  const { frameHeight } = calcFrameDimensions(context, frames.length);

  context.fillStyle = calcFramesGradient(frames, context);
  context.fillRect(
    0,
    WINDOW_STROKE_THICKNESS,
    context.canvas.width,
    frameHeight - WINDOW_STROKE_THICKNESS * 2,
  );
};

const FramesHeatMap = ({
  frames,
  checkedFramesArray,
  totalNumberOfFrames,
  ...props
}: {
  frames: { risk: number; isDeleted: boolean | undefined }[] | null;
  checkedFramesArray: boolean[];
  totalNumberOfFrames: number | null;
} & React.HTMLAttributes<HTMLCanvasElement>) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const HEATMAP_COMMON_CLASS = `${props.className} h-10`;

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || !frames) {
      return;
    }

    const context = canvas.getContext('2d')!;
    const dpi = window.devicePixelRatio;
    const styleHeight = Number(
      getComputedStyle(canvas).getPropertyValue('height').slice(0, -2),
    );
    const styleWidth = Number(
      getComputedStyle(canvas).getPropertyValue('width').slice(0, -2),
    );
    canvas.setAttribute('height', String(styleHeight * dpi));
    canvas.setAttribute('width', String(styleWidth * dpi));

    drawFrameRisks(context, frames);

    const selectedSequences = findTrueSequences(checkedFramesArray);

    selectedSequences.forEach(sequence => {
      drawWindow(context, sequence[0], sequence[1], totalNumberOfFrames);
    });
  }, [frames, checkedFramesArray]);

  if (!frames) {
    return (
      <div className="flex flex-row flex-1 justify-center text-gray-500 text-5xl">
        <IconWarning />
        <p className="mt-4">Failed to get frames, check console</p>
      </div>
    );
  }

  if (frames.length === 0) {
    return (
      <div
        className={`flex flex-row flex-1 justify-center items-center ${HEATMAP_COMMON_CLASS} bg-gray-200 text-gray-500 text-3xl`}
      >
        <BarsSpinner />
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className={`w-full ${HEATMAP_COMMON_CLASS}`}
    ></canvas>
  );
};

export default FramesHeatMap;
