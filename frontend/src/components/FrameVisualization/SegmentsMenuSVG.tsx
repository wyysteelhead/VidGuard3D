import {
  MouseEventHandler,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { IconWarning } from '../icons';
import { Spinner } from '../spinners';
import {
  getNumberOfRelationsPerSegment,
  getSegmentsData,
  getCheckedSegmentBorderData,
  SVG_VIEWBOX_HEIGHT,
  SVG_VIEWBOX_WIDTH,
  getRelationData,
  SegmentData,
  RelationData,
} from './segmentMenuSvgLogic';
import { Frame } from '@/model';

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

const SegmentTooltipContent = ({
  segmentData,
}: {
  segmentData: SegmentData;
}) => {
  return (
    <>
      <h2 className="text-center font-bold">Segment</h2>
      <div className="grid grid-cols-2 items-center p-2 gap-2">
        <img
          src={segmentData.imageSrc}
          alt={`Frame ${segmentData.thumbnailFrameIndex + 1}`}
        />
        <div className="flex flex-col">
          <p>
            Frames: {segmentData.startFrame} - {segmentData.endFrame}
          </p>
          <p>Length: {calcSegmentLengthMilliseconds(segmentData.nFrames)} ms</p>
          <p>Max risk: {segmentData.maxRisk.toFixed(2)}</p>
        </div>
      </div>
    </>
  );
};

const RelationTooltipContent = ({
  relationData,
}: {
  relationData: RelationData;
}) => {
  return <div className="p-4">{relationData.name}</div>;
};

const SegmentsMenuSVG = ({
  frames,
  segments,
  totalNumberOfFrames,
  segmentRelations,
  checkedSegmentsArray,
  setCheckedSegmentsArray,
  onSegmentClick,
  ...props
}: {
  frames: Frame[];
  segments: number[] | null;
  totalNumberOfFrames: number;
  segmentRelations: number[][];
  checkedSegmentsArray: boolean[];
  setCheckedSegmentsArray: (newValue: boolean[]) => void;
  onSegmentClick?: (index: number) => void;
} & React.HTMLAttributes<HTMLDivElement>) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipContent, setTooltipContent] = useState<ReactNode | null>(null);

  if (segments === null) {
    return (
      <div
        className={`flex justify-center items-center h-40 ${props.className}`}
      >
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
      <div
        className={`flex justify-center items-center h-40 ${props.className}`}
      >
        <span className="text-white text-5xl fill-primary">
          <Spinner />
        </span>
      </div>
    );
  }

  const segmentsData = getSegmentsData(segments, frames);

  // sort segment relations by strength
  segmentRelations = segmentRelations.sort((a, b) => a[2] - b[2]);

  const segmentRelationCounts =
    getNumberOfRelationsPerSegment(segmentRelations);
  const largestRelationGap = Math.max(
    ...segmentRelations.map(relation => relation[1] - relation[0]),
  );
  const checkedBorders = getCheckedSegmentBorderData(
    checkedSegmentsArray,
    segmentsData,
    totalNumberOfFrames,
  );

  const handleSegmentClicks = (indicies: number[]) => {
    const newArray = [...checkedSegmentsArray];

    // check is all clicked indicies are checked
    if (indicies.every(index => checkedSegmentsArray[index])) {
      // if so, uncheck all clicked
      indicies.forEach(index => {
        newArray[index] = false;
      });
    } else {
      // if not, check all
      indicies.forEach(index => {
        newArray[index] = true;
      });
    }

    setCheckedSegmentsArray(newArray);
  };

  const handleMouseOver = tooltipContent => {
    if (!tooltipRef.current) {
      return;
    }
    tooltipRef.current.style.setProperty('visibility', 'visible');
    setTooltipContent(tooltipContent);
  };

  const mouseMove: MouseEventHandler<SVGRectElement | SVGPathElement> = e => {
    const MOUSE_MARGIN = 15;
    if (!tooltipRef.current) {
      return;
    }
    tooltipRef.current.style.setProperty('left', `${e.pageX + MOUSE_MARGIN}px`);
    tooltipRef.current.style.setProperty('top', `${e.pageY + MOUSE_MARGIN}px`);
  };
  const mouseOut = () => {
    if (!tooltipRef.current) {
      return;
    }
    tooltipRef.current.style.setProperty('visibility', 'hidden');
  };

  return (
    <>
      <div
        ref={wrapperRef}
        className={`${props.className} w-full flex flex-row flex-nowrap overflow-x-auto gap-2 px-0 pt-0 pb-0`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="100%"
          height="100%"
          viewBox={`0 0 ${SVG_VIEWBOX_WIDTH} ${SVG_VIEWBOX_HEIGHT}`}
          preserveAspectRatio="XMidYMid meet"
        >
          {/* SEGMENTS */}
          {segmentsData.map((segmentData, i) => {
            if (
              Number.isNaN(segmentData.startX) ||
              !Number.isFinite(segmentData.startX) ||
              Number.isNaN(segmentData.width) ||
              !Number.isFinite(segmentData.width)
            ) {
              return null;
            }
            return (
              <rect
                key={`segment-${i}`}
                x={segmentData.startX}
                y={segmentData.startY}
                width={segmentData.width}
                height={segmentData.height}
                fill={segmentData.fillColor}
                className="cursor-pointer hover:opacity-80"
                onClick={() => handleSegmentClicks([i])}
                onMouseOver={() =>
                  handleMouseOver(
                    <SegmentTooltipContent segmentData={segmentData} />,
                  )
                }
                onMouseMove={mouseMove}
                onMouseOut={mouseOut}
              />
            );
          })}
          {/* CHECKED SEGMENTS BORDERS */}
          {checkedBorders.map((checkedBorder, i) => {
            if (
              Number.isNaN(checkedBorder.startX) ||
              !Number.isFinite(checkedBorder.startX) ||
              Number.isNaN(checkedBorder.width) ||
              !Number.isFinite(checkedBorder.width)
            ) {
              return null;
            }
            return (
              <rect
                key={`border-${i}`}
                x={checkedBorder.startX}
                y={checkedBorder.startY}
                width={checkedBorder.width}
                height={checkedBorder.height}
                fill={checkedBorder.fillColor}
                stroke={checkedBorder.stroke}
                strokeWidth={checkedBorder.strokeWidth}
              />
            );
          })}
          {/* RELATIONS */}
          {segmentRelations.map((relation: number[], i) => {
            const relationData = getRelationData(
              i,
              segmentRelations,
              checkedSegmentsArray,
              segmentsData,
              segmentRelationCounts,
              totalNumberOfFrames,
              largestRelationGap,
            );

            // show only 100 strongest relations
            if (i > 99) {
              return null;
            }

            // // decrement counts
            // segmentRelationCounts[relation[0]].nAlreadyDrawn -= 1;
            // segmentRelationCounts[relation[1]].nAlreadyDrawn -= 1;

            return (
              <path
                key={`relation-${i}`}
                name={relationData.name}
                d={`M ${relationData.startX} ${relationData.startEndY}
                    C ${relationData.startX} ${relationData.viaY}
                      ${relationData.endX} ${relationData.viaY}
                      ${relationData.endX} ${relationData.startEndY}
                  `}
                fill="none"
                stroke={relationData.stroke}
                strokeWidth={relationData.strokeWidth}
                className="cursor-pointer hover:stroke-black"
                onClick={() => {
                  handleSegmentClicks(relation);
                }}
                onMouseOver={() =>
                  handleMouseOver(
                    <RelationTooltipContent relationData={relationData} />,
                  )
                }
                onMouseMove={mouseMove}
                onMouseOut={mouseOut}
              />
            );
          })}
        </svg>
        <div
          ref={tooltipRef}
          style={{
            position: 'absolute',
            visibility: 'hidden',
            zIndex: 1000,
          }}
          className="max-w-xs border-2 bg-white bg-opacity-90 rounded-md shadow-md p-2"
        >
          {tooltipContent}
        </div>
      </div>
    </>
  );
};

export default SegmentsMenuSVG;
