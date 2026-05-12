import { useState } from 'react';
import { Slider } from 'antd';
import { SliderMarks } from 'antd/es/slider';
import { changeLossRange, changeMaxDeletion } from '../../services/request';
// import 'antd/dist/antd.css';

const MySlider = ({
  max,
  min,
  small,
  large,
  label,
  setSmall,
  setLarge,
  range,
  marks,
  onChange,
  ...props
}: {
  max: number;
  min: number;
  small: number;
  large?: number;
  label: string;
  setSmall: (value: number) => void;
  setLarge?: (value: number) => void;
  range?: boolean;
  marks: SliderMarks;
  onChange: (value: number | number[]) => void;
} & React.HTMLAttributes<HTMLDivElement>) => {
  const onBaseChange = value => {
    if (Array.isArray(value)) {
      setSmall(value[0]);
      setLarge!(value[1]);
      onChange([value[0], value[1]]);
    } else {
      setSmall(value);
      onChange(value);
    }
  };
  return (
    <div className="" {...props}>
      <div className="">{label}</div>
      {range ? (
        <Slider
          className=""
          range
          marks={marks}
          defaultValue={[small, large!]}
          max={max}
          min={min}
          onChange={onBaseChange}
        />
      ) : (
        <Slider
          className=""
          marks={marks}
          defaultValue={small}
          max={max}
          min={min}
          onChange={onChange}
        />
      )}
    </div>
  );
};

const ControlPannel = () => {
  const marks: SliderMarks = {
    0: {
      style: {
        color: 'black',
      },
      label: '0',
    },
    100: {
      style: {
        color: 'black',
      },
      label: '+',
    },
  };
  const [lossRangeSmall, setLossRangeSmall] = useState(10);
  const [lossRangeLarge, setLossRangeLarge] = useState(70);
  const [maxDeletion, setMaxDeletion] = useState(10);
  const onChangeLossRange = data => {
    changeLossRange(data);
  };
  const onChangeMaxDeletion = data => {
    changeMaxDeletion(data);
  };
  return (
    <div className="p-2 text-sm text-gray-500">
      <div className="grid grid-cols-2 gap-4">
        <MySlider
          id="loss-range"
          label={'loss range'}
          min={0}
          max={100}
          small={lossRangeSmall}
          setSmall={setLossRangeSmall}
          large={lossRangeLarge}
          setLarge={setLossRangeLarge}
          range
          marks={marks}
          onChange={onChangeLossRange}
        />
        <MySlider
          id="max-deletion"
          label={'max deletion'}
          min={0}
          max={100}
          small={maxDeletion}
          setSmall={setMaxDeletion}
          marks={marks}
          onChange={onChangeMaxDeletion}
        />
      </div>
    </div>
  );
};

export default ControlPannel;
