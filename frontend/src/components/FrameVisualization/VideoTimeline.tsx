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

const VideoTimeline = ({
  totalNumberOfFrames,
  // selectedCompareEdits,
  // zoomDataCallback,
  ...props
}: {
  totalNumberOfFrames: number;
  // selectedCompareEdits: (...args: any[]) => void;
  // zoomDataCallback: (...args: any[]) => void;
} & React.HTMLAttributes<HTMLDivElement>) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [edits, setEdits] = useState<EditElement[]>([]);
  // state
  const editsForComparisons = useStore(state => state.editsForComparisons);
  const editsPlans = useStore(state => state.editsPlans);

  const [selectedEdits, setSelectedEdits] = useState<EditElement[]>([]);
  const [zoomData, setZoomData] = useState<any | null>(null);
  const { id: projectId } = useParams();
  const [breakPoints, setBreakPoints] = useState<EditElement[]>([]);

  useEffect(() => {
    setEdits(editsForComparisons);
  }, [editsForComparisons]);

  // 添加显示current plan的edit操作
  useEffect(() => {
    if (editsPlans.length > 0) {
      const currentPlan = editsPlans[editsPlans.length - 1]; // 最新的plan
      if (currentPlan?.plan) {
        setEdits([...editsForComparisons, ...currentPlan.plan]);
      }
    }
  }, [editsPlans, editsForComparisons]);

  useEffect(() => {
    const fetchData = async () => {
      // 获取zoomData
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
      // 获取 breakPoint
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
      // 初始化 ECharts 实例
      chartRef.current = echarts.init(wrapperRef.current);
      // 配置项和数据
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
            // params 是一个数组，包含多个数据项
            let tooltipContent = '';
            // params.forEach(function (param) {
            const frame = params[0].data[0];
            const time = params[0].data[3];
            const zoom = params[0].data[1];

            // 构建每个数据项的 tooltip 内容
            tooltipContent += `"frame":${frame},"time":${time},"zoom":${zoom}<br/>`;
            // });
            return tooltipContent;
          },
        },
        legend: {
          data: ['zoom'],
          show: false, // 显示图例
        },
        grid: {
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          show: true, // 显示网格
          borderColor: '#000', // 边框颜色为黑色
          borderWidth: 1, // 边框宽度为1像素
          backgroundColor: 'rgba(0,0,0,0)', // 网格背景颜色（透明）
        },
        singleAxis: {
          top: 0,
          bottom: 0,
          right: 1,
          left: -3,
          axisTick: {
            show: false, // 隐藏刻度
          },
          axisLabel: {
            show: true, // 显示刻度标签
            formatter(value) {
              // 自定义格式化函数，显示序号
              return `No.${value}`;
            },
          },
          type: 'value' as const, // 使用数值类型轴
          axisPointer: {
            animation: true,
            label: {
              show: true,
            },
          },
          splitLine: {
            show: false, // 隐藏分割线
          },
        },
        series: [
          {
            type: 'themeRiver' as const,
            itemStyle: {
              color: 'rgba(247, 216, 164, 1.0)', // 设置正常状态的颜色
            },
            emphasis: {
              itemStyle: {
                shadowBlur: 0, // 关闭阴影模糊
                shadowColor: 'rgba(0, 0, 0, 0)', // 关闭阴影颜色
                animation: false, // 关闭悬停时的动画
                color: 'rgba(247, 216, 164, 1.0)', // 设置悬停时的颜色与正常状态相同
              },
              label: {
                show: false, // 隐藏悬停时的标签
                animation: false, // 关闭悬停时的标签动画
              },
            },
            data: [],
            label: {
              show: false, // 隐藏图例标签
            },
          },
        ],
      };

      // 使用刚指定的配置项和数据显示图表
      option && chartRef.current.setOption(option);

      // 监听窗口大小变化，调整图表大小
      const resizeHandler = () => {
        if (chartRef.current) {
          chartRef.current.resize();
        }
      };

      window.addEventListener('resize', resizeHandler);

      // 组件卸载时销毁 ECharts 实例和事件监听
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
      // 创建一个虚线数组
      const lineOptions = breakPoints.map(point =>
        point.toEChartsOption(chartWidth, chartHeight, 'line'),
      );
      // 假设 chart 是你的 ECharts 实例
      const currentGraphic =
        (chartRef.current.getOption().graphic as echarts.EChartsOption[]) || [];
      // 过滤掉 'rect' 和 'line' 类型的 graphic 元素
      const filteredGraphic = currentGraphic.filter(
        item => item.type !== 'rect' && item.type !== 'line',
      );
      // 将新的图形元素添加到过滤后的图形设置中
      const newGraphic = filteredGraphic.concat(editOptions, lineOptions);
      // 更新图表的 graphic 属性
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
              // 在加入下一个选中之前，先取消第一个被选中的edit的选中状态
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
      // 重新渲染图表
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
        className={`${props.className} col-span-11 h-[120px]`}
      >
      </div>
    </>
  );
};

export default VideoTimeline;
