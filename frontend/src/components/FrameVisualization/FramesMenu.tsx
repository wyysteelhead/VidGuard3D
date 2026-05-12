import { RefObject, useEffect, useRef, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import Spinner, { BarsSpinner } from '../spinners';
import { getColorDeletedRgba, getColorByRisk } from '../../../resources/colors';
import { Frame, useStore } from '../../model';
import { genFrameImgSrcString } from './SegmentsMenu';
import { calcSegmentEndFrameIndex } from '.';

const DEFAULT_FRAME_RATE = 30;

function setRangeInArrayToTrue(array: boolean[], start: number, end: number) {
  for (let i = start; i <= end; i++) {
    array[i] = true;
  }
  return array;
}

function calcItemWidth(
  wrapperRef: RefObject<HTMLDivElement>,
  numberOfFramesInSelectedSegment: number,
  min = 10,
  max = 20,
) {
  const wrapperWidth = wrapperRef?.current
    ? wrapperRef.current.offsetWidth
    : 1500;
  let itemWidth = wrapperWidth / numberOfFramesInSelectedSegment / 3;
  itemWidth = Math.min(itemWidth, max);
  itemWidth = Math.max(itemWidth, min);
  return itemWidth;
}

function buildThumbnail(index: number, frames: string | any[]) {
  if (frames.length === 0) {
    return (
      <div className="flex justify-center items-center bg-gray-50 h-20 aspect-square">
        <span className="text-xl text-white fill-gray-500">
          <Spinner />
        </span>
      </div>
    );
  }
  return (
    <img
      className="object-cover h-20"
      alt={`Frame ${index + 1}`}
      src={genFrameImgSrcString(frames[index])}
    />
  );
}

export function frameNumberToVideoTimestamp(frameNumber: number) {
  return new Date((frameNumber * 1000) / DEFAULT_FRAME_RATE)
    .toISOString()
    .substr(14, 9);
}

function buildTooltipContent(index: number, frames: { risk: number }[]) {
  return (
    <div
      style={{
        backgroundColor: frames[index]
          ? getColorByRisk(frames[index].risk)
          : '',
      }}
      className="flex flex-row justify-center items-center bg-gray-200 text-gray-800 p-4 rounded-xl gap-3"
    >
      {buildThumbnail(index, frames)}
      <div className="flex flex-col text-sm">
        <p className="text-lg text-black font-medium">
          Frame <span className="font-mono">{index + 1}</span>
        </p>
        <p className="flex flex-row">
          Risk:&nbsp;
          <span className="">
            {frames[index] ? frames[index].risk.toFixed(2) : <BarsSpinner />}
          </span>
        </p>
        <p className="flex flex-row">
          Time:&nbsp;
          <span className="">{frameNumberToVideoTimestamp(index)}</span>
        </p>
      </div>
    </div>
  );
}

function buildTooltipTrigger(
  index: number,
  lastCheckedIndex: number | null,
  frames: string | any[],
  checkedFramesArray: boolean[],
  itemWidth: number,
  totalNumberOfFrames: number,
  handleFrameClick: (frameIndex: any, event: React.MouseEvent) => void,
) {
  if (frames.length === 0) {
    return (
      <div
        className={`flex flex-col w-10 justify-center items-center shadow-md bg-gray-200 text-white fill-gray-500 p-2`}
      >
        <Spinner />
      </div>
    );
  }

  let borderClassName = '';
  if (checkedFramesArray[index]) {
    borderClassName = 'border-y-4';
    if (index === 0 || !checkedFramesArray[index - 1]) {
      // left edge of selection
      borderClassName += ' border-l-4';
    }
    if (index === totalNumberOfFrames - 1 || !checkedFramesArray[index + 1]) {
      // right edge of selection
      borderClassName += ' border-r-4';
    }
  } else {
    borderClassName = 'border-0';
  }

  return (
    <a
      data-checked={checkedFramesArray[index]}
      data-disabled={frames[index]?.isDeleted}
      onClick={event => {
        handleFrameClick(index, event);
      }}
      style={{
        backgroundColor: frames[index].isDeleted
          ? getColorDeletedRgba()
          : getColorByRisk(frames[index].risk),
        width: `${itemWidth}px`,
      }}
      className={`flex flex-col justify-center items-center shadow-md py-2
        border-primary ${borderClassName}
        h-6 data-[checked=true]:h-9
        hover:scale-y-150
        transition-transform duration-200 ease-in-out
      `}
    >
      <span className="sr-only">{`Frame ${index + 1}`}</span>
    </a>
  );
}

const FramesMenu = ({
  globalFrames,
  segments,
  totalNumberOfFrames,
  checkedSegmentsArray,
  checkedFramesArray,
  setCheckedFramesArray,
  ...props
}: {
  globalFrames: Frame[]; // 有is deleted参数
  segments: number[];
  totalNumberOfFrames: number;
  checkedSegmentsArray: boolean[];
  checkedFramesArray: boolean[];
  setCheckedFramesArray: (...args: any[]) => void;
} & React.HTMLAttributes<HTMLDivElement>) => {
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [lastCheckedIndex, setLastCheckedIndex] = useState<number | null>(null);

  const firstCheckedFrameIndex = checkedFramesArray.findIndex(
    checked => checked,
  );
  const lastCheckedFrameIndex = checkedFramesArray.findLastIndex(
    checked => checked,
  );

  const itemWidth = calcItemWidth(
    wrapperRef,
    lastCheckedFrameIndex - firstCheckedFrameIndex + 1,
  );
  const editsForComparisons = useStore(state => state.editsForComparisons);
  const originalRisk = useStore(state => state.originalRisk);
  const [frames, setFrames] = useState<Frame[]>(globalFrames); // Includes the isDeleted flag.

  useEffect(() => {
    if (globalFrames.length > 0) {
      setFrames(globalFrames);
      // setOriginalRisk(globalFrames);
    }
  }, [globalFrames]);

  useEffect(() => {
    if (editsForComparisons.length === 0 && globalFrames.length > 0) {
      setFrames(structuredClone(originalRisk));
      // setOriginalRisk(globalFrames);
    }
    else {
      editsForComparisons.forEach(edit => {
        const newFrames = [...globalFrames];
        // Ensure all frames have isDeleted property
        newFrames.forEach(frame => {
          if (frame && frame.isDeleted === undefined) {
            frame.isDeleted = false;
          }
        });

        for (let i = edit.startIndex; i <= edit.endIndex!; i++) {
          // Check if frame exists to prevent undefined errors
          if (newFrames[i]) {
            if (edit.type === 'delete') {
              newFrames[i].isDeleted = true;
              newFrames[i].risk = 0;
            } else {
              newFrames[i].risk = Math.min(newFrames[i].risk, edit.risk[i - edit.startIndex]);
            }
          }
        }
        setFrames(newFrames);
      });
    }
  }, [editsForComparisons]);

  // disable auto scroll to selected frames feature (currently broken)
  // useEffect(() => {
  //   if (frames.length === 0) {
  //     return;
  //   }
  //   setLastCheckedIndex(null);

  //   const padStartFrames = 3;

  //   if (wrapperRef.current) {
  //     const frames = wrapperRef.current.querySelectorAll('a');
  //     frames[
  //       Math.max(firstCheckedFrameIndex - padStartFrames, 0)
  //     ].scrollIntoView({
  //       behavior: 'smooth',
  //       block: 'start',
  //       inline: 'start',

  //     });
  //   }
  // }, [checkedSegmentsArray]);

  const handleFrameClick = (frameIndex: number, event: React.MouseEvent) => {
    const isFrameChecked = checkedFramesArray[frameIndex];
    let newLastCheckedIndex: number | null = null;
    let newCheckedFramesArray = [...checkedFramesArray];

    if (lastCheckedIndex === null) {
      newLastCheckedIndex = frameIndex;
      newCheckedFramesArray[frameIndex] = !isFrameChecked;
    } else if (!isFrameChecked && event.shiftKey) {
      newCheckedFramesArray = setRangeInArrayToTrue(
        [...checkedFramesArray],
        Math.min(frameIndex, lastCheckedIndex),
        Math.max(frameIndex, lastCheckedIndex),
      );
    } else {
      newLastCheckedIndex = frameIndex;
      newCheckedFramesArray[frameIndex] = !isFrameChecked;
    }

    setLastCheckedIndex(newLastCheckedIndex!);
    setCheckedFramesArray([...newCheckedFramesArray]);
  };

  return (
    <div
      ref={wrapperRef}
      className={`${props.className} flex flex-row flex-1 items-center overflow-x-scroll px-2 pt-3 pb-5`}
    >
      {[...Array(totalNumberOfFrames).keys()].map(index => {
        return (
          <Tooltip.Provider key={index} delayDuration={0}>
            <Tooltip.Root>
              <Tooltip.Trigger>
                {buildTooltipTrigger(
                  index,
                  lastCheckedIndex,
                  frames,
                  checkedFramesArray,
                  itemWidth,
                  totalNumberOfFrames,
                  handleFrameClick,
                )}
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content>
                  {buildTooltipContent(index, frames)}
                  <Tooltip.Arrow
                    style={{
                      fill: frames[index]
                        ? getColorByRisk(frames[index].risk)
                        : '',
                    }}
                    className="fill-gray-200"
                    height={20}
                  />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </Tooltip.Provider>
        );
      })}
    </div>
  );
};

export default FramesMenu;
