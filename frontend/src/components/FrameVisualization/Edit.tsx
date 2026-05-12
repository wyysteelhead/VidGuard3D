import { Point } from '../ViedeoEditor/canvasLogic';

class EditElement {
  static totalNumberOfFrames: number = 0;
  static count: number = 0;

  id: number;
  type: string;
  startIndex: number;
  endIndex: number | null;
  polygon: (any[] | null)[];
  selected: boolean;
  selectionCount: number;
  risk: number[];
  style: string = '';

  constructor(
    id: number,
    type: string,
    startIndex: number,
    endIndex: number | null = null,
    risk: number[] = [],
    polygon: (any[] | null)[] = [],
    style = '',
  ) {
    this.id = id;
    this.startIndex = startIndex;
    this.endIndex = endIndex;
    this.type = type;
    this.polygon = polygon;
    this.selected = false;
    this.selectionCount = 0;
    this.risk = risk;
    this.style = style;
  }

  update(
    type: string,
    startIndex: number,
    endIndex: number | null,
    polygon: (any[] | null)[],
  ) {
    this.startIndex = startIndex;
    this.endIndex = endIndex;
    this.type = type;
    this.polygon = polygon;
  }

  setRisk(risk: number[]) {
    this.risk = risk;
  }

  toggleSelection() {
    if (this.selected) {
      EditElement.count--;
    } else {
      EditElement.count++;
    }
    this.selected = !this.selected;
    this.selectionCount = 0;
  }

  toEChartsOption(
    chartWidth: number,
    chartHeight: number,
    mode = 'single',
  ): echarts.EChartsOption {
    const x = (this.startIndex / EditElement.totalNumberOfFrames) * chartWidth;
    const width =
      ((this.endIndex! - this.startIndex) / EditElement.totalNumberOfFrames) *
      chartWidth;
    let fillColor = 'rgba(102, 102, 102, 0.5)';
    let borderColor = 'transparent';
    if (this.selected && this.selectionCount) {
      borderColor =
        this.selectionCount === 1
          ? 'rgba(247, 147, 30, 1)'
          : 'rgba(197, 84, 159, 1)';
    }
    if (this.type === 'delete') {
      fillColor = 'rgba(255, 255, 255, 1)';
    }
    if (mode === 'compare') {
      return {
        id: this.id,
        type: 'line',
        shape: {
          x1: x,
          y1: 0,
          x2: x,
          y2: chartHeight, // 你可能需要根据你的图表大小调整这个值
        },
        style: {
          stroke: 'black', // 线的颜色
          lineType: 'dashed', // 虚线
          lineDash: [2, 2],
          lineWidth: 1, // 线的粗细
        },
        tooltip: {
          show: true,
          formatter: () => 'breakpoints',
        },
        z: 200, // 确保矩形在其他图表元素之上
      };
    } else if (this.type === 'breakpoints') {
      return {
        id: this.id,
        type: 'line',
        shape: {
          x1: x,
          y1: 0,
          x2: x,
          y2: chartHeight, // 你可能需要根据你的图表大小调整这个值
        },
        style: {
          stroke: 'black', // 线的颜色
          lineType: 'dashed', // 虚线
          lineDash: [10, 10],
          lineWidth: 2, // 线的粗细
        },
        tooltip: {
          show: true,
          formatter: () => this.type,
        },
        z: 200, // 确保矩形在其他图表元素之上
      };
    } else {
      return {
        id: this.id,
        type: 'rect',
        shape: {
          x,
          y: 0.8,
          width,
          height: chartHeight - 1.6,
        },
        style: {
          fill: fillColor,
          stroke: borderColor,
          lineWidth: 5,
          strokePosition: 'inside',
        },
        tooltip: {
          show: true,
          formatter: () => this.type,
        },
        z: 100, // 确保矩形在其他图表元素之上
      };
    }
  }
}

export default EditElement;
