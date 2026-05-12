import { useEffect, useRef } from 'react';
import { IconWarning } from '../icons';
import { Spinner } from '../spinners';
import { getColorDeletedRgba, getColorByRisk } from '../../../resources/colors';
import { calcSegmentEndFrameIndex } from '.';

const DEFAULT_FRAME_RATE = 30;

function calcSegmentLengthMilliseconds(
  numberOfFramesInSegment: number,
  frameRate = DEFAULT_FRAME_RATE,
) {
  return ((numberOfFramesInSegment / frameRate) * 1000).toFixed(0);
}

export function genFrameImgSrcString(frame: {
  image: { format: string; data: string };
}) {
  return `data:image/${frame.image.format};base64,${frame.image.data}`;
}

const SegmentsMenu = ({
  frames,
  segments,
  totalNumberOfFrames,
  checkedSegmentsArray,
  setCheckedSegmentsArray,
  onSegmentClick,
  ...props
}: {
  frames: any[];
  segments: number[] | null;
  totalNumberOfFrames: number;
  checkedSegmentsArray: boolean[];
  setCheckedSegmentsArray: (newValue: boolean[]) => void;
  onSegmentClick?: (index: number) => void;
} & React.HTMLAttributes<HTMLDivElement>) => {
  const wrapperRef = useRef<HTMLDivElement>(null);

  if (segments === null) {
    return (
      <div className="flex justify-center items-center h-[256px]">
        <div className="flex flex-col justify-center items-center text-xl">
          <span className="text-3xl">
            <IconWarning />
          </span>
          <p className="mt-4">Failed to get segments, check console</p>
        </div>
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className="flex justify-center items-center h-[256px]">
        <span className="text-white text-5xl fill-primary">
          <Spinner />
        </span>
      </div>
    );
  }

  const handleSegmentClick = (index: number) => {
    const newArray = checkedSegmentsArray.map((value, i) => (i === index ? !value : value));
    setCheckedSegmentsArray(newArray);
  };

  const out: React.ReactElement[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segmentStartIndex = segments[i];

    const segmentEndIndex = calcSegmentEndFrameIndex(
      segments,
      i,
      totalNumberOfFrames,
    )!;

    const numberOfFramesInSegment = segmentEndIndex - segmentStartIndex + 1;

    const segmentMedianFrameIndex = Math.floor(
      (segmentStartIndex + segmentEndIndex) / 2,
    );

    const segmentRiskValue: number | null = Math.max(
      ...frames
        .slice(segmentStartIndex, segmentEndIndex + 1)
        .map(frame => frame.risk),
    );

    const isSegmentDeleted =
      frames.length > 0
        ? frames
            .slice(segmentStartIndex, segmentEndIndex + 1)
            .every(frame => frame.isDeleted)
        : false;

    let segmentBgColor = '';
    if (isSegmentDeleted) {
      segmentBgColor = getColorDeletedRgba();
    } else if (frames.length > 0) {
      segmentBgColor = getColorByRisk(segmentRiskValue);
    }

    let segmentThumbnail: React.ReactElement | null = null;
    if (frames[segmentMedianFrameIndex]) {
      segmentThumbnail = (
        <img
          className="object-cover h-40"
          alt={`Frame ${segmentMedianFrameIndex + 1}`}
          src={genFrameImgSrcString(frames[segmentMedianFrameIndex])}
        />
      );
    } else {
      segmentThumbnail = (
        <div className="flex justify-center items-center h-40 aspect-square">
          <span className="text-3xl text-white fill-gray-500">
            <Spinner />
          </span>
        </div>
      );
    }

    out.push(
      <a
        style={{
          backgroundColor: segmentBgColor,
        }}
        className="flex flex-col shadow-md hover:scale-105 max-w-fit justify-center min-w-fit p-2 hover:bg-opacity-60 bg-gray-300 data-[checked=true]:outline data-[checked=true]:outline-4 data-[checked=true]:outline-primary cursor-pointer"
        onClick={() => {
          handleSegmentClick(i);
        }}
        data-checked={checkedSegmentsArray[i]}
        key={i}
      >
        {segmentThumbnail}
        <p className="font-mono text-center text-xs mt-2 mb-0">
          {`${numberOfFramesInSegment} frame${
            numberOfFramesInSegment === 1 ? '' : 's' // add conditional pluralization
          } (${calcSegmentLengthMilliseconds(numberOfFramesInSegment)}ms)`}
        </p>
      </a>,
    );
  }
  return (
    <>
      <div
        ref={wrapperRef}
        className={`${props.className} w-full flex flex-row flex-nowrap overflow-x-auto gap-2 px-2 pt-4 pb-4`}
      >
        {out}
      </div>
    </>
  );
};

export default SegmentsMenu;
