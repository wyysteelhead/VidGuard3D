import ReactECharts from 'echarts-for-react';
import { useRouteLoaderData } from '@modern-js/runtime/router';
import { useEffect, useState } from 'react';
import InfoTip from '../InfoTip';
import {
  InfoCharts,
  InfoChartsLine,
  InfoChartsPie,
} from '../InfoTip/infoContent';
import ViewHeading, { ViewSubHeading } from '../ViewHeading';
import { getColorByRisk, getColorDeletedRgba } from '../../../resources/colors';
import { IconCircle, IconCircleFill } from '../icons';
import TimelineChart from '../FrameVisualization/TimelineChart';
import exampleSVG from '../../../resources/chartsvg.svg';
import {
  buildFrameLineOption,
  shouldShowTwoCharts,
  shouldShowDeletedInLegend,
  buildFrameBarOption,
} from './echartsLogic';
import { Frame, useStore } from '@/model';
import EditElement from '../FrameVisualization/Edit';
import {
  compressBooleanMatrixToBase64,
  lerpPolygon,
  createBooleanMaskFromImagePolygon,
} from '../ViedeoEditor/canvasLogic';

const pieLegendConfig = [
  {
    riskRange: [0.8, 1.0],
    riskColor: getColorByRisk(1),
  },
  {
    riskRange: [0.6, 0.8],
    riskColor: getColorByRisk(0.75),
  },
  {
    riskRange: [0.4, 0.6],
    riskColor: getColorByRisk(0.5),
  },
  {
    riskRange: [0.2, 0.4],
    riskColor: getColorByRisk(0.25),
  },
  {
    riskRange: [0.0, 0.2],
    riskColor: getColorByRisk(0),
  },
];

const Charts = ({ updatedFrames }: { updatedFrames: any[] }) => {
  const originalRisk = useStore(state => state.originalRisk);
  const [originalRisks, setOriginalRisks] = useState<number[]>([]);
  const { frames: framesData } = useRouteLoaderData('[id]/page') as any;
  const [selectedPlanForExport, setSelectedPlanForExport] = useState<'current' | 'previous'>('current');
  const [showDropdown, setShowDropdown] = useState(false);

  const editsPlans = useStore(state => state.editsPlans);
  const first = editsPlans.at(-1) ?? null;
  const second = editsPlans.at(-2) ?? null;
  const frameWidthFromStore = useStore(state => state.frameWidth);
  const frameHeightFromStore = useStore(state => state.frameHeight);

  useEffect(() => {
    framesData
      .then((result: Frame[]) => {
        const risks = result.map(value => value.risk);
        setOriginalRisks(risks);
      })
      .catch(() => {
      });
  }, []);

  useEffect(() => {
    const risks = originalRisk.map(value => value.risk);
    setOriginalRisks(risks);
  }, [originalRisk]);

  async function exportModifiedVideo() {
    const selectedPlan = selectedPlanForExport === 'current' ? first : second;

    if (!selectedPlan) {
      return;
    }

    const plan: any[] = selectedPlan.plan || [];

    // build selected_frame boolean array for full video length
    const totalFrames = originalRisks.length;
    const selected_frame = new Array(totalFrames).fill(false);
    const base64_data: string[] = [];
    const mask_width = frameWidthFromStore;
    const delete_frames_set = new Set<number>();

    // First pass: collect delete operations
    for (const edit of plan) {
      if (edit.type === 'delete') {
        const s = edit.startIndex;
        const e = edit.endIndex ?? s;
        for (let i = s; i <= e; i++) {
          delete_frames_set.add(i);
        }
      }
    }

    // Second pass: collect mask operations and build base64_data in selected_frame order
    const maskFrameData: { [frameIndex: number]: string } = {};
    for (const edit of plan) {
      if (edit.type === 'mask') {
        // edit.polygon expected to be [startPolygon, endPolygon]
        const startPoly = edit.polygon?.[0] ?? null;
        const endPoly = edit.polygon?.[1] ?? null;
        const s = edit.startIndex;
        const e = edit.endIndex ?? s;
        const n = e - s + 1;
        if (!startPoly || !endPoly) {
          continue;
        }

        for (let idx = 0; idx < n; idx++) {
          const frameIndex = s + idx;
          const t = n === 1 ? 0 : idx / (n - 1);
          const poly = lerpPolygon(startPoly, endPoly, t);

          if (!mask_width) {
            console.warn('missing frame width in store, skipping mask generation');
            continue;
          }

          // Use the frame dimensions already loaded into the store by VideoEditor.
          
          if (!frameHeightFromStore) {
            console.warn('frameHeightFromStore is null, skipping mask generation');
            continue;
          }

          const frameHeight = frameHeightFromStore;

          // Build the boolean mask directly from the polygon in original image coordinates.
          const booleanMask = createBooleanMaskFromImagePolygon(
            poly,
            mask_width as number,
            frameHeight,
          );
          const b64 = compressBooleanMatrixToBase64(booleanMask);
          maskFrameData[frameIndex] = b64;
          selected_frame[frameIndex] = true;
        }
      }
    }

    // Build base64_data array in the order that selected_frame=true appears
    for (let i = 0; i < totalFrames; i++) {
      if (selected_frame[i] && maskFrameData[i]) {
        base64_data.push(maskFrameData[i]);
      }
    }

    const delete_frames = Array.from(delete_frames_set.values()).sort((a, b) => a - b);

    const payload: any = {
      base64_data,
      width: mask_width,
      selected_frame,
      delete_frames,
    };

    try {
      const res = await fetch(`${process.env.CONFIG.BACKEND_API_BASE_URL}data/${window.location.pathname.split('/').pop()}/export_modified_video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const blob = await res.blob();
        const contentDisposition = res.headers.get('content-disposition');
        const filename = contentDisposition
          ? contentDisposition.split('filename=')[1]?.replace(/"/g, '')
          : 'modified_video.mp4';

        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } else {
        console.error('Export failed:', res.status);
      }
    } catch (err) {
      console.error('export failed', err);
    }
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showDropdown) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showDropdown]);

  return (
    <>
      <div className="flex flex-col flex-1 bg-white p-4 rounded-xl">
        <div className="flex h-5 w-full">
          <ViewHeading className="mt-1">plan assessment</ViewHeading>
          <img
            src={exampleSVG}
            alt="description of image"
            className="ml-20 w-28 h-14"
          />
        </div>
        <div className="w-full mb-3">
          <div className="flex items-center justify-start gap-2">
            <div className="relative inline-block">
              <div className="flex">
                <button
                  onClick={() => exportModifiedVideo()}
                  disabled={!first && !second}
                  className="py-1 px-3 text-xs text-black uppercase shadow-md rounded-l-md bg-primary hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed border border-gray-300"
                >
                  Export
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDropdown(!showDropdown);
                  }}
                  disabled={!second}
                  className="py-1 px-2 text-xs text-black shadow-md rounded-r-md bg-primary hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed border border-l-0 border-gray-300 flex items-center"
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
              {showDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-10 min-w-full">
                  <button
                    onClick={() => {
                      setSelectedPlanForExport('current');
                      setShowDropdown(false);
                    }}
                    className={`w-full px-3 py-2 text-xs text-left hover:bg-gray-100 flex items-center justify-between ${selectedPlanForExport === 'current' ? 'bg-blue-50 text-blue-600' : ''}`}
                  >
                    <span>Current Plan</span>
                    {selectedPlanForExport === 'current' && (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setSelectedPlanForExport('previous');
                      setShowDropdown(false);
                    }}
                    disabled={!second}
                    className={`w-full px-3 py-2 text-xs text-left hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between ${selectedPlanForExport === 'previous' ? 'bg-blue-50 text-blue-600' : ''}`}
                  >
                    <span>Previous Plan</span>
                    {selectedPlanForExport === 'previous' && (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col flex-1 justify-center text-gray-600 pt-2">
          <ViewSubHeading>
            Risk trend:{' '}
            <InfoTip>
              <InfoChartsPie />
            </InfoTip>
          </ViewSubHeading>
          <div className="flex-1 flex flex-row">
            {/* <div className="flex flex-col justify-center">
              {
                <>
                  <p className="text-lg">Top chart:</p>
                  <p className="text-sm -mt-1">Last risk assessment</p>
                  <p className="text-lg">Bottom chart:</p>
                  <p className="text-sm -mt-1 mb-2">Current risk assessment</p>
                </>
              }
            </div> */}
            <div className="flex-1 grid grid-flow-row h-[280px]">
              <ReactECharts
                className="mt-[-40px]"
                style={{ height: '200px', width: '100%' }}
                option={buildFrameLineOption(
                  originalRisks,
                  first?.risk?.map(value => value.risk) ?? null,
                  '#e9983e',
                )}
              />
              <ReactECharts
                className="mt-[-80px]"
                style={{ height: '200px', width: '100%' }}
                option={buildFrameLineOption(
                  originalRisks,
                  second?.risk?.map(value => value.risk) ?? null,
                  '#b75b9c',
                )}
              />
            </div>
          </div>
          <ViewSubHeading className="mt-[-30px]">
            Risk distribution:{' '}
            <InfoTip>
              <InfoChartsLine />
            </InfoTip>
          </ViewSubHeading>
          <ReactECharts
            className="mt-[-100px]"
            style={{ height: '200px', marginTop: '-40px' }}
            option={buildFrameBarOption(
              first?.risk?.map(value => value.risk) ?? null,
              second?.risk?.map(value => value.risk) ?? null,
              originalRisks,
            )}
          />
          <ViewSubHeading className="mt-[-30px]">
            TIMELINE FLUENCY:{' '}
            <InfoTip>
              <InfoChartsLine />
            </InfoTip>
          </ViewSubHeading>
          <TimelineChart
            className="col-span-11 mt-[14px]"
            totalNumberOfFrames={originalRisks.length}
            planNumber={1}
          />
          <TimelineChart
            className="col-span-11"
            totalNumberOfFrames={originalRisks.length}
            planNumber={2}
          />
        </div>
        {/* <div className="flex flex-col flex-1 justify-center text-gray-600 pt-2"></div> */}
      </div>
    </>
  );
};

export default Charts;
