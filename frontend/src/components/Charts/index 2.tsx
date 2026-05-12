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

  const editsPlans = useStore(state => state.editsPlans);
  const first = editsPlans.at(-1) ?? null;
  const second = editsPlans.at(-2) ?? null;

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

  return (
    <>
      <div className="flex flex-col flex-1 bg-white p-4 rounded-xl">
        <div className="flex h-5 w-full">
          <ViewHeading className="mt-1">plan comparison</ViewHeading>
          <img
            src={exampleSVG}
            alt="description of image"
            className="ml-20 w-28 h-14"
          />
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
