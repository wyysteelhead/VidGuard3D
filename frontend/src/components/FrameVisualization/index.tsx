import { useEffect, useRef, useState, memo, useCallback } from 'react';
import { useParams, useRouteLoaderData } from '@modern-js/runtime/router';
import { InfoFrameSelection } from '../InfoTip/infoContent';
import InfoTip from '../InfoTip';
import ViewHeading, { ViewSubHeading } from '../ViewHeading';
import { useStore, Frame } from '../../model';
import SegmentZoomControl from './SegmentZoomControl';
import SegmentsMenu from './SegmentsMenu';
import FramesMenu from './FramesMenu';
import FramesHeatMap from './FramesHeatMap';
import VideoTimeline from './VideoTimeline';
import SegmentsMenuSVG from './SegmentsMenuSVG';

export function calcSegmentEndFrameIndex(
  segments: number[] | null,
  segmentIndex: number,
  totalNumberOfFrames: number,
): number {
  if (segments === null) {
    return 1;
  }

  if (segments.length === 0) {
    return 1;
  }

  return segments[segmentIndex + 1]
    ? segments[segmentIndex + 1] - 1
    : totalNumberOfFrames - 1;
}

const FrameVisualization = ({
  frames,
  segments,
  totalNumberOfFrames,
  segmentRelations,
  checkedSegmentsArray,
  setCheckedSegmentsArray,
  updateSegmentsCallback,
  checkedFramesArray,
  setCheckedFramesArray,
  setCompareEdits,
  setZoomData,
  edits,
}: {
  frames: Frame[];
  [x: string]: any;
}) => {
  const [updatedFrames, setUpdatedFrames] = useState(frames);
  const [updatedCheckedFramesArray, setUpdatedCheckedFramesArray] =
    useState(checkedFramesArray);
  const editsForComparisons = useStore(state => state.editsForComparisons);
  const setEditsForComparisons = useStore(
    state => state.setEditsForComparisons,
  );
  const updateEditsPlans = useStore(state => state.updateEditsPlans);
  const editsPlans = useStore(state => state.editsPlans);
  const setEditsPlans = useStore(state => state.setEditsPlans);
  const originalRisk = useStore(state => state.originalRisk);

  // Prefer plan risk data when available; otherwise fall back to the original frames.
  useEffect(() => {
    if (editsPlans.length > 0) {
      const currentPlan = editsPlans[editsPlans.length - 1]; // Latest plan.
      if (currentPlan?.risk && currentPlan.risk.length > 0) {
        setUpdatedFrames(currentPlan.risk);
        return; // Use plan data directly when it is available.
      }
    }
    // Fall back to the original frames only when no plan data exists.
    setUpdatedFrames(frames);
  }, [frames, editsPlans]);

  useEffect(() => {
    setUpdatedCheckedFramesArray(checkedFramesArray);
  }, [checkedFramesArray]);

  const clearAndSaveEdit = () => {
    updateEditsPlans(oldArray => [
      ...oldArray,
      { plan: [], risk: structuredClone(originalRisk) },
    ]);
    setEditsForComparisons([]);
  };


  useEffect(() => {
    if (editsForComparisons.length > 0) {
      const newFrames = structuredClone(originalRisk);
      // Ensure all frames have isDeleted property
      newFrames.forEach(frame => {
        if (frame.isDeleted === undefined) {
          frame.isDeleted = false;
        }
      });
      
      editsForComparisons.forEach(edit => {
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
      });

      const newEditsPlans =
        editsPlans.length > 0
          ? [...editsPlans]
          : [{ plan: [...editsForComparisons], risk: newFrames }];
      newEditsPlans[newEditsPlans.length - 1] = {
        plan: [...editsForComparisons],
        risk: newFrames,
      };

      setEditsPlans(newEditsPlans);
    }
    else if (originalRisk.length > 0) {
      setUpdatedFrames(structuredClone(originalRisk));
    }
  }, [editsForComparisons]);

  return (
    <div className="flex flex-col justify-center bg-white p-4 rounded-xl">
      <div className="flex flex-row justify-between items-center">
        <ViewHeading>
          Plan assessment{' '}
          <InfoTip>
            <InfoFrameSelection />
          </InfoTip>
        </ViewHeading>
        <div className="flex flex-row justify-center items-center gap-4 text-lg text-gray-400">
          <p className="">
            total frames:&nbsp;
            <span className="font-mono font-bold">{totalNumberOfFrames}</span>
          </p>
          <p className="">
            selected frames:&nbsp;
            <span className="font-mono font-bold">
              {
                updatedCheckedFramesArray.filter(value => {
                  return value;
                }).length
              }
            </span>
          </p>
          <button
            className="py-2 text-xl text-black uppercase shadow-md rounded-xl bg-primary hover:bg-primary-dark px-2"
            onClick={clearAndSaveEdit}
          >
            New Plan
          </button>
          {/* <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() =>
                setCheckedFramesArray(Array(totalNumberOfFrames).fill(false))
              }
              className="py-1 px-4 bg-gray-400 hover:bg-gray-500 text-sm shadow-md rounded-xl gap-2 text-white"
            >
              Unselect all frames
            </button>
            <button
              onClick={() =>
                setCheckedFramesArray(Array(totalNumberOfFrames).fill(true))
              }
              className="py-1 px-4 bg-primary hover:bg-primary-dark text-sm shadow-md rounded-xl gap-2 text-white"
            >
              Select all frames
            </button>
          </div> */}
        </div>
      </div>
      <div className="grid grid-cols-12 items-center">
        {/* <ViewSubHeading
          className="py-2 ml-10 direction[rtl]"
        >
          Risk Overview
        </ViewSubHeading> */}
        <ViewSubHeading className="py-2 mr-2">
          Risk By <br /> Frame:
        </ViewSubHeading>
        <FramesMenu
          className="col-span-11"
          globalFrames={updatedFrames}
          segments={segments}
          totalNumberOfFrames={totalNumberOfFrames}
          checkedSegmentsArray={checkedSegmentsArray}
          checkedFramesArray={updatedCheckedFramesArray}
          setCheckedFramesArray={setCheckedFramesArray}
        />
        <div className="py-2 mr-2 mt-1">
          <div className="mr-2 text-gray-400">
            <p className="">
              Relate by camera:
              <br />
              <br />
            </p>
          </div>
          <div className="mr-2">
            <ViewSubHeading>Risk By Segment:</ViewSubHeading>
          </div>{' '}
        </div>
        <SegmentsMenuSVG
          className="col-span-11"
          frames={updatedFrames}
          segments={segments}
          totalNumberOfFrames={totalNumberOfFrames}
          segmentRelations={segmentRelations}
          checkedSegmentsArray={checkedSegmentsArray}
          setCheckedSegmentsArray={setCheckedSegmentsArray}
        />

        <div className="py-2 mr-2">
          <ViewSubHeading className="mt--10">Promotion:</ViewSubHeading>
          {/* <button
            title='Clear Selections'
            className='flex justify-center items-center text-xl p-2 rounded-xl shadow-md uppercase bg-gray-400 hover:bg-gray-500 text-black disabled:cursor-not-allowed disabled:opacity-50'
            onClick={clearSelections}
        >
          Clear Selections
        </button> */}
        </div>
        <VideoTimeline
          className="col-span-11"
          totalNumberOfFrames={totalNumberOfFrames}
          // selectedCompareEdits={setCompareEdits}
          // zoomDataCallback={setZoomData}
        />
      </div>
    </div>
  );
};

export default FrameVisualization;
