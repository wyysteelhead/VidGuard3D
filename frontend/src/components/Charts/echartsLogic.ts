import { EChartsOption } from 'echarts-for-react';
import { getColorByRisk, getColorDeletedRgba } from '../../../resources/colors';
import { findTrueSequences } from '../FrameVisualization/FramesHeatMap';

export function buildFrameLineOption(
  origRisks: number[] | null,
  currRisks: number[] | null,
  color: string,
): EChartsOption {
  /** @type EChartsOption */
  const out: EChartsOption = {
    title: {
      text: 'Video frame risks distribution',
      show: false,
    },
    xAxis: {
      type: 'category',
      name: 'Frames',
      nameLocation: 'middle',
      nameGap: 20,
      boundaryGap: false,
      data: origRisks?.map((_, i) => i) ?? [],
    },
    yAxis: {
      type: 'value',
      name: 'Risk Value',
      nameLocation: 'middle',
      nameGap: 35,
    },
    tooltip: {
      trigger: 'item',
      // formatter: '{a} - {b}:<br />{d}% ({c} frames)',
    },
    series: [] as any[],
    color: [color],
    toolbox: {
      show: false,
      feature: {
        saveAsImage: {},
      },
    },
  };

  if (origRisks) {
    out.series.push({
      name: 'Original risks',
      type: 'line',
      data: origRisks,
      areaStyle: {
        color: '#d0d0d0',
      },
      lineStyle: {
        color: '#d0d0d0',
      },
      itemStyle: {
        opacity: 0,
      },
    });
  }

  if (currRisks) {
    out.series.push({
      name: 'Current risks',
      type: 'line',
      data: currRisks,
      areaStyle: {
        color,
      },
      lineStyle: {
        color,
      },
      itemStyle: {
        opacity: 0,
      },
    });
  }

  return out;
}

export function buildFrameBarOption(
  firstRisks: number[] | null,
  secondRisks: number[] | null,
  origRisks: number[],
): EChartsOption {
  const out = {
    legend: {
      data: [],
    },
    tooltip: {},
    dataset: {
      source: [
        ['Plan', 'previous', 'Original', 'current'],
        ['1.0-0.8', 0, 0, 0],
        ['0.8-0.6', 0, 0, 0],
        ['0.6-0.4', 0, 0, 0],
        ['0.4-0.2', 0, 0, 0],
        ['0.2-0.0', 0, 0, 0],
      ],
    },
    color: ['#e9983e', '#9c9c9c', '#bc5b9c'],
    xAxis: {
      type: 'category',
      name: 'Risk Ranges',
      nameLocation: 'middle',
      nameGap: 20,
      inverse: true, // 添加这行代码将反向 x 轴上的数据
    },
    yAxis: { name: 'Frames', nameLocation: 'middle', nameGap: 35 },
    // Declare several bar series, each will be mapped
    // to a column of dataset.source by default.
    series: [{ type: 'bar' }, { type: 'bar' }, { type: 'bar' }],
  };

  for (let i = 0; i < origRisks.length; i++) {
    const origRisk = origRisks[i];
    if (firstRisks) {
      const firstRisk = firstRisks[i];
      if (firstRisk >= 0.8) {
        (out.dataset.source[1][1] as number)++;
      } else if (firstRisk >= 0.6) {
        (out.dataset.source[2][1] as number)++;
      } else if (firstRisk >= 0.4) {
        (out.dataset.source[3][1] as number)++;
      } else if (firstRisk >= 0.2) {
        (out.dataset.source[4][1] as number)++;
      } else if (firstRisk >= 0) {
        (out.dataset.source[5][1] as number)++;
      }
    }
    if (secondRisks) {
      const secondRisk = secondRisks[i];
      if (secondRisk >= 0.8) {
        (out.dataset.source[1][3] as number)++;
      } else if (secondRisk >= 0.6) {
        (out.dataset.source[2][3] as number)++;
      } else if (secondRisk >= 0.4) {
        (out.dataset.source[3][3] as number)++;
      } else if (secondRisk >= 0.2) {
        (out.dataset.source[4][3] as number)++;
      } else if (secondRisk >= 0) {
        (out.dataset.source[5][3] as number)++;
      }
    }

    if (origRisk >= 0.8) {
      (out.dataset.source[1][2] as number)++;
    } else if (origRisk >= 0.6) {
      (out.dataset.source[2][2] as number)++;
    } else if (origRisk >= 0.4) {
      (out.dataset.source[3][2] as number)++;
    } else if (origRisk >= 0.2) {
      (out.dataset.source[4][2] as number)++;
    } else if (origRisk >= 0) {
      (out.dataset.source[5][2] as number)++;
    }
  }

  return out;
}

function buildLineChartVisualMapPieces(numberOfIntervals = 10) {
  const pieces: {
    gte: number;
    lte?: number;
    color: string;
  }[] = [
    {
      gte: 0,
      lte: 1 / numberOfIntervals,
      color: getColorByRisk(1 / numberOfIntervals),
    },
  ];

  for (let i = 1; i < numberOfIntervals; i++) {
    pieces.push({
      gte: i / numberOfIntervals,
      lte: (i + 1) / numberOfIntervals,
      color: getColorByRisk(i / numberOfIntervals),
    });
  }

  pieces.push({
    gte: 1,
    color: getColorByRisk(1),
  });

  return pieces;
}

function buildLineChartSeriesDeletedFrameMarkAreas(
  deletedFrameIndices: number[] | null,
) {
  if (deletedFrameIndices === null || deletedFrameIndices.length === 0) {
    return [];
  }

  const booleanArrayOfDeletedFrames = Array(
    Math.max(...deletedFrameIndices) + 1,
  ).fill(false);

  deletedFrameIndices.forEach(i => {
    booleanArrayOfDeletedFrames[i] = true;
  });

  const trueSequences = findTrueSequences(booleanArrayOfDeletedFrames);

  return {
    itemStyle: {
      color: getColorDeletedRgba(0.3),
    },
    label: {
      show: false,
    },
    data: trueSequences.map(value => {
      return [
        { name: `Deleted frames ${value[0]} - ${value[1]}`, xAxis: value[0] },
        { xAxis: value[1] },
      ];
    }),
  };
}

export function shouldShowTwoCharts(
  risks1: any | null,
  risks2: any | null,
): boolean {
  if (!risks1) {
    return false;
  }

  if (!risks2) {
    return false;
  }

  return true;
}

export function shouldShowDeletedInLegend(
  deletedFrames1: number[] | null,
  deletedFrames2: number[] | null,
) {
  if (!deletedFrames1) {
    return false;
  }

  if (!deletedFrames2) {
    return false;
  }

  return deletedFrames1.length > 0 || deletedFrames2.length > 0;
}

function sliceRiskPie(
  risks: number[],
  deletedFrameIndices: number[] | null = [],
): Array<{
  value: number;
  name: string;
}> {
  if (risks.length === 0) {
    return [];
  }

  const pie = [
    { value: 0, name: 'Deleted frames' },
    { value: 0, name: '0 to 0.2' },
    { value: 0, name: '0.2 to 0.4' },
    { value: 0, name: '0.4 to 0.6' },
    { value: 0, name: '0.6 to 0.8' },
    { value: 0, name: '0.8 to 1' },
  ];

  for (let i = 0; i < risks.length; i++) {
    const risk = risks[i];

    if (deletedFrameIndices?.includes(i)) {
      pie[0].value++;
    } else if (risk >= 0 && risk < 0.2) {
      pie[1].value++;
    } else if (risk >= 0.2 && risk < 0.4) {
      pie[2].value++;
    } else if (risk >= 0.4 && risk < 0.6) {
      pie[3].value++;
    } else if (risk >= 0.6 && risk < 0.8) {
      pie[4].value++;
    } else if (risk >= 0.8 && risk <= 1) {
      pie[5].value++;
    }
  }

  return pie;
}
