import React, { useRef, useEffect, useState } from 'react';
import * as echarts from 'echarts';
import { useParams } from '@modern-js/runtime/router';
import {
  getZoomDataById,
  getBreakPointById,
} from '../../routes/[id]/page.data';
import { ViewSubHeading } from '../ViewHeading';
import { useStore } from '../../model';
import EditElement from './Edit';
import { frameNumberToVideoTimestamp } from './FramesMenu';

const baseApiUrl = process.env.CONFIG.BACKEND_API_BASE_URL;

const TimelineChart = ({
  totalNumberOfFrames,
  planNumber = 0,
  // selectedCompareEdits,
  // zoomDataCallback,
  ...props
}: {
  totalNumberOfFrames: number;
  planNumber: number;
  // selectedCompareEdits: (...args: any[]) => void;
  // zoomDataCallback: (...args: any[]) => void;
} & React.HTMLAttributes<HTMLDivElement>) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [edits, setEdits] = useState<EditElement[]>([]);
  // state
  // const editsForComparisons = useStore(state => state.editsForComparisons);
  const editsPlans = useStore(state => state.editsPlans);

  const [selectedEdits, setSelectedEdits] = useState<EditElement[]>([]);
  const [zoomData, setZoomData] = useState<any | null>(null);
  const { id: projectId } = useParams();
  const [breakPoints, setBreakPoints] = useState<EditElement[]>([]);

  useEffect(() => {
    setEdits(editsPlans.map(edit => edit.plan).at(-planNumber) ?? []);
  }, [editsPlans]);

  useEffect(() => {
    const fetchData = async () => {
      // Fetch zoomData.
      try {
        const data = await getZoomDataById(projectId);
        const echartsData = data.map((item, index: number) => {
          const zoomValues = item.zoom;
          return [
            index + 1,
            zoomValues,
            'zoom',
            frameNumberToVideoTimestamp(index),
          ];
        });
        setZoomData(echartsData);
      } catch (error) {
        console.error('Error fetching data:', error);
      }
      // Fetch breakpoints.
      try {
        const data = await getBreakPointById(projectId);
        const echartsData: EditElement[] = data.break_points.map(
          (item, index: number) => {
            return new EditElement(index + 1, 'breakpoints', item);
          },
        );
        setBreakPoints(echartsData);
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };

    fetchData();
  }, [projectId]);

  useEffect(() => {
    if (zoomData) {
      // 更新 ECharts 的 data 内容
      if (chartRef.current) {
        chartRef.current.setOption({
          series: [
            {
              data: zoomData,
            },
          ],
          singleAxis: {
            max: zoomData.length,
          },
        });
      }
    }
  }, [zoomData]);

  useEffect(() => {
    if (wrapperRef.current) {
      // Initialize the ECharts instance.
      chartRef.current = echarts.init(wrapperRef.current);
      // Base configuration and data.
      const option = {
        tooltip: {
          trigger: 'axis' as const,
          axisPointer: {
            type: 'line' as const,
            lineStyle: {
              color: 'rgba(0,0,0,0.2)',
              width: 1,
              type: 'solid' as const,
            },
          },
          formatter(params) {
            // params is an array that contains multiple data items.
            let tooltipContent = '';
            // params.forEach(function (param) {
            const frame = params[0].data[0];
            const time = params[0].data[3];
            const zoom = params[0].data[1];

            // Build the tooltip content for each data item.
            tooltipContent += `"frame":${frame},"time":${time},"zoom":${zoom}<br/>`;
            // });
            return tooltipContent;
          },
        },
        legend: {
          data: ['zoom'],
          show: false, // Hide the legend.
        },
        grid: {
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          show: true, // 显示网格
          borderColor: '#000', // Black border.
          borderWidth: 1, // One-pixel border.
          backgroundColor: 'rgba(0,0,0,0)', // Transparent grid background.
        },
        singleAxis: {
          top: 0,
          bottom: 0,
          right: 1,
          left: -3,
          axisTick: {
            show: false, // Hide ticks.
          },
          axisLabel: {
            show: true, // Show tick labels.
            formatter(value) {
              // Custom formatter that displays the index.
              return `No.${value}`;
            },
          },
          type: 'value' as const, // Use a numeric axis.
          axisPointer: {
            animation: true,
            label: {
              show: true,
            },
          },
          splitLine: {
            show: false, // Hide split lines.
          },
        },
        series: [
          {
            type: 'themeRiver' as const,
            itemStyle: {
              color:
                planNumber === 1
                  ? 'rgba(247, 216, 164, 1.0)'
                  : 'rgba(214, 164, 200, 1.0)', // Default color.
            },
            emphasis: {
              itemStyle: {
                shadowBlur: 0, // Disable shadow blur.
                shadowColor: 'rgba(0, 0, 0, 0)', // Disable shadow color.
                animation: false, // Disable hover animation.
                color: 'rgba(247, 216, 164, 1.0)', // Keep hover color equal to the default color.
              },
              label: {
                show: false, // Hide hover labels.
                animation: false, // Disable hover label animation.
              },
            },
            data: [],
            label: {
              show: false, // Hide legend labels.
            },
          },
        ],
      };

      // Render the chart with the configured options.
      option && chartRef.current.setOption(option);

      // Resize the chart when the window changes size.
      const resizeHandler = () => {
        if (chartRef.current) {
          chartRef.current.resize();
        }
      };

      window.addEventListener('resize', resizeHandler);

      // Destroy the ECharts instance and listeners on unmount.
      return () => {
        if (chartRef.current) {
          chartRef.current.dispose();
        }
        window.removeEventListener('resize', resizeHandler);
      };
    }
  }, []);

  useEffect(() => {
    EditElement.totalNumberOfFrames = totalNumberOfFrames;
  }, [totalNumberOfFrames]);

  useEffect(() => {
    if (chartRef.current && wrapperRef.current) {
      const chartWidth = wrapperRef.current.offsetWidth;
      const chartHeight = wrapperRef.current.offsetHeight;
      const editOptions = edits.map(edit =>
        edit.toEChartsOption(chartWidth, chartHeight),
      );
      // Build the breakpoint overlay elements.
      const lineOptions = breakPoints.map(point =>
        point.toEChartsOption(chartWidth, chartHeight, 'compare'),
      );
      // chartRef.current is the active ECharts instance.
      const currentGraphic =
        (chartRef.current.getOption().graphic as echarts.EChartsOption[]) || [];
      // Remove existing rect and compare overlay elements.
      const filteredGraphic = currentGraphic.filter(
        item => item.type !== 'rect' && item.type !== 'compare',
      );
      // Append the new overlay elements.
      const newGraphic = filteredGraphic.concat(editOptions, lineOptions);
      // Update the chart overlay graphics.
      chartRef.current.setOption({
        graphic: newGraphic,
      });
      chartRef.current.resize();
    }
  }, [breakPoints, edits]);

  // const addEdit = edit => {
  //   const newEdit = new Edit(
  //     Date.now(),
  //     edit.startIndex,
  //     edit.endIndex,
  //     edit.type,
  //     edit.polygon,
  //   );
  //   setEdits(prev => [...prev, newEdit]);
  // };

  // const deleteEdit = id => {
  //   setEdits(prev => prev.filter(edit => edit.id !== id));
  // };

  const handleChartClick = params => {
    if (
      params.componentType === 'graphic' &&
      params.event &&
      params.event.target
    ) {
      const element = params.event.target;
      if (element?.id) {
        const editId = Number(element.id);
        const edit = edits.find(e => e.id === editId);
        if (edit) {
          edit.toggleSelection();
          if (edit.selected) {
            if (selectedEdits.length < 2 && selectedEdits.length > 0) {
              // Deselect the first selected edit before adding another one.
              const firstSelectedEdit = selectedEdits[0];
              firstSelectedEdit.toggleSelection();
              setSelectedEdits(prev => prev.slice(1));
              setEdits(prev =>
                prev.map(e =>
                  e.id === firstSelectedEdit.id ? firstSelectedEdit : e,
                ),
              );
            }
            setSelectedEdits(prev => [...prev, edit]);
          } else {
            setSelectedEdits(prev => prev.filter(e => e.id !== editId));
          }
          setEdits(prev => {
            const updatedEdits = prev.map(e => {
              if (e.id === editId) {
                return edit;
              }
              return e;
            });
            return updateSelectedCount(updatedEdits);
          });
          setSelectedEdits(prev => updateSelectedCount(prev));
        }
      }
      // Re-render the chart overlay.
      if (chartRef.current && wrapperRef.current) {
        const chartWidth = wrapperRef.current.offsetWidth;
        const chartHeight = wrapperRef.current.offsetHeight;
        const editOptions = edits.map(edit =>
          edit.toEChartsOption(chartWidth, chartHeight),
        );
        chartRef.current.setOption({
          graphic: editOptions,
        });
      }
    }
  };

  const updateSelectedCount = edits => {
    return edits.map((edit, index: number) => {
      if (index < 2) {
        edit.selectionCount = index + 1;
      } else {
        edit.selectionCount = 0;
      }
      return edit;
    });
  };

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.on('click', handleChartClick);
      return () => {
        chartRef.current?.off('click', handleChartClick);
      };
    }

    return () => {};
  }, [edits]);
  const clearSelections = () => {
    setEdits(prev =>
      prev.map(edit => {
        edit.selected = false;
        edit.selectionCount = 0;
        return edit;
      }),
    );
    setSelectedEdits([]);
  };

  // useEffect(() => {
  //   if (selectedEdits.length === 2) {
  //     selectedCompareEdits(selectedEdits);
  //   }
  // }, [selectedEdits, selectedCompareEdits]);

  // useEffect(() => {
  //   zoomDataCallback(zoomData);
  // }, [zoomData, zoomDataCallback]);

  return (
    <>
      <div
        ref={wrapperRef}
        className={`${props.className} col-span-11 h-[70px]`}
      ></div>
    </>
  );
};

export default TimelineChart;
