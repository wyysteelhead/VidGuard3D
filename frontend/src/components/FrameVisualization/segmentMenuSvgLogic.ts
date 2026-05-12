import {
  getColorByRisk,
  getColorDeletedRgba,
  getColorSelectionRgba,
} from 'resources/colors';
import { genFrameImgSrcString } from './SegmentsMenuSVG';
import { calcSegmentEndFrameIndex } from '.';
import { Frame } from '@/model';

export const SVG_VIEWBOX_WIDTH = 300;
export const SVG_VIEWBOX_HEIGHT = 20;

const SEGMENT_Y_START = SVG_VIEWBOX_HEIGHT * 0.5;
const SEGMENT_Y_END = SVG_VIEWBOX_HEIGHT;
const RELATIONS_Y_START = 0;
const RELATIONS_Y_END = SVG_VIEWBOX_HEIGHT * 0.4;

export type SegmentData = {
  startFrame: number;
  endFrame: number;
  nFrames: number;
  fillColor: string;
  isDeleted: boolean;
  imageSrc: string;
  thumbnailFrameIndex: number;
  minRisk: number;
  medRisk: number;
  maxRisk: number;
  avgRisk: number;
  startX: number;
  startY: number;
  width: number;
  height: number;
};

enum RelationSelectedState {
  SEMICHECKED_INV = -1,
  UNCHECKED = 0,
  SEMICHECKED = 0.5,
  CHECKED = 1,
}

export type RelationData = {
  name: string;
  strength: number;
  startX: number;
  endX: number;
  startEndY: number;
  viaY: number;
  checkedState: RelationSelectedState;
  stroke: string;
  strokeWidth: number;
};

/**
 * @description
 * Turn a list of segment relations into a tree format.
 * Each key in the tree is a segment index, and the value is an array of segment indices
 * that are connected to the key segment index.
 * @param {number[][]} segmentRelations - a list of segment relations, where each relation is a pair of segment indices
 * @returns {Object.<number, number[]>} - a tree of segment relations
 */
export function getNumberOfRelationsPerSegment(segmentRelations: number[][]): {
  [key: number]: {
    nRelations: number;
    nAlreadyDrawn: number;
  };
} {
  const segmentRelationsTree = {};
  segmentRelations.forEach(segmentRelation => {
    const firstSegment = segmentRelation[0];
    const secondSegment = segmentRelation[1];

    if (!segmentRelationsTree[firstSegment]) {
      segmentRelationsTree[firstSegment] = {
        nRelations: 1,
        nAlreadyDrawn: 0,
      };
    } else {
      segmentRelationsTree[firstSegment].nRelations += 1;
    }

    if (!segmentRelationsTree[secondSegment]) {
      segmentRelationsTree[secondSegment] = {
        nRelations: 1,
        nAlreadyDrawn: 0,
      };
    } else {
      segmentRelationsTree[secondSegment].nRelations += 1;
    }
  });
  return segmentRelationsTree;
}

export const getSegmentData = (
  index: number,
  segments: number[],
  frames: Frame[],
): SegmentData => {
  const segmentStartIndex = segments[index];
  const segmentEndIndex = calcSegmentEndFrameIndex(
    segments,
    index,
    frames.length,
  );

  const nFramesInSegment = segmentEndIndex - segmentStartIndex + 1;

  const segmentRisks = frames
    .slice(segmentStartIndex, segmentEndIndex + 1)
    .map(frame => frame.risk);
  const isSegmentDeleted =
    frames.length > 0
      ? frames
          .slice(segmentStartIndex, segmentEndIndex + 1)
          .every(frame => frame.isDeleted)
      : false;

  const maxRisk: number = Math.max(...segmentRisks);
  const thumbnailFrameIndex: number = frames.findIndex(
    frame => frame.risk === maxRisk,
  );
  let imgSrc = '';
  if (frames[thumbnailFrameIndex]) {
    imgSrc = genFrameImgSrcString(frames[thumbnailFrameIndex]);
  }

  let segmentBgColor = '';
  if (isSegmentDeleted) {
    segmentBgColor = getColorDeletedRgba();
  } else if (frames.length > 0) {
    segmentBgColor = getColorByRisk(maxRisk);
  }

  return {
    startX: (segmentStartIndex * SVG_VIEWBOX_WIDTH) / frames.length,
    startY: SEGMENT_Y_START,
    width: (SVG_VIEWBOX_WIDTH / frames.length) * nFramesInSegment,
    height: SEGMENT_Y_END - SEGMENT_Y_START,
    startFrame: segmentStartIndex,
    endFrame: segmentEndIndex,
    nFrames: nFramesInSegment,
    fillColor: segmentBgColor,
    isDeleted: isSegmentDeleted,
    imageSrc: imgSrc,
    thumbnailFrameIndex,
    minRisk: Math.min(...segmentRisks),
    medRisk: segmentRisks.sort((a, b) => a - b)[
      Math.floor(segmentRisks.length / 2)
    ],
    maxRisk,
    avgRisk: segmentRisks.reduce((a, b) => a + b, 0) / segmentRisks.length,
  };
};

export function getSegmentsData(
  segments: number[],
  frames: Frame[],
): SegmentData[] {
  const segmentsData: SegmentData[] = [];
  for (let i = 0; i < segments.length; i++) {
    segmentsData.push(getSegmentData(i, segments, frames));
  }
  return segmentsData;
}

export const getRelationData = (
  relationIndex: number,
  relations: number[][],
  checkedSegmentsArray: boolean[],
  segmentsData: SegmentData[],
  segmentRelationCounts: {
    [key: number]: {
      nRelations: number;
      nAlreadyDrawn: number;
    };
  },
  totalNumberOfFrames,
  largestRelationGap,
): RelationData => {
  const firstSegmentIndex = Math.min(
    relations[relationIndex][0],
    relations[relationIndex][1],
  );
  const secondSegmentIndex = Math.max(
    relations[relationIndex][0],
    relations[relationIndex][1],
  );
  const relationGap = secondSegmentIndex - firstSegmentIndex;
  const relationStrength = relations[relationIndex][2];

  let checkedState = RelationSelectedState.SEMICHECKED_INV;
  let strokeOpacity = 0.0;
  if (checkedSegmentsArray.every(value => value === false)) {
    strokeOpacity = 0.4;
    checkedState = RelationSelectedState.UNCHECKED;
  }

  if (
    checkedSegmentsArray[firstSegmentIndex] &&
    checkedSegmentsArray[secondSegmentIndex]
  ) {
    checkedState = RelationSelectedState.CHECKED;
    strokeOpacity = 1.0;
  } else if (
    checkedSegmentsArray[firstSegmentIndex] ||
    checkedSegmentsArray[secondSegmentIndex]
  ) {
    checkedState = RelationSelectedState.SEMICHECKED;
    strokeOpacity = 1.0;
  }

  const firstSegmentWidth = segmentsData[firstSegmentIndex].width;
  const secondSegmentWidth = segmentsData[secondSegmentIndex].width;

  const startOffset: number = firstSegmentWidth / 2;
  const endOffset: number = secondSegmentWidth / 2;

  return {
    name: `Segment ${firstSegmentIndex + 1} & ${secondSegmentIndex + 1}`,
    strength: relationStrength,
    startX: segmentsData[firstSegmentIndex].startX + startOffset,
    endX: segmentsData[secondSegmentIndex].startX + endOffset,
    startEndY: SEGMENT_Y_START,
    viaY:
      (relationGap / largestRelationGap) *
        (RELATIONS_Y_START - RELATIONS_Y_END) +
      RELATIONS_Y_END, // lerp
    checkedState,
    stroke: getRelationColor(checkedState),
    strokeWidth:
      getStrokeWidth(totalNumberOfFrames) *
      2 *
      Math.max(relationStrength, 0.25),
  };
};

type CheckedBorderData = {
  startX: number;
  width: number;
  startY: number;
  height: number;
  fillColor: string;
  stroke: string;
  strokeWidth: number;
};

export function getCheckedSegmentBorderData(
  checkedSegmentsArray: boolean[],
  segmentsData: SegmentData[],
  totalNumberOfFrames: number,
): CheckedBorderData[] {
  const trueSequences = findTrueSequences(checkedSegmentsArray);
  return trueSequences.map(sequence => {
    return {
      startX: segmentsData[sequence[0]].startX,
      width:
        segmentsData[sequence[1]].startX -
        segmentsData[sequence[0]].startX +
        segmentsData[sequence[1]].width,
      startY: SEGMENT_Y_START,
      height: SEGMENT_Y_END - SEGMENT_Y_START,
      fillColor: 'none',
      stroke: getColorSelectionRgba(),
      strokeWidth: getStrokeWidth(totalNumberOfFrames),
    };
  });
}

function getRelationColor(checkedState: RelationSelectedState): string {
  switch (checkedState) {
    case RelationSelectedState.SEMICHECKED_INV:
      return getColorSelectionRgba(0.0);
    case RelationSelectedState.UNCHECKED:
      return getColorSelectionRgba(0.5);
    case RelationSelectedState.SEMICHECKED:
      return getColorSelectionRgba(0.75);
    case RelationSelectedState.CHECKED:
      return getColorSelectionRgba(1);
    default:
      return getColorSelectionRgba(0.5);
  }
}

function getStrokeWidth(totalNumberOfFrames: number): number {
  return SVG_VIEWBOX_WIDTH / totalNumberOfFrames;
}

function findTrueSequences(array) {
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
