// @ts-check
import { useState } from 'react';
import { useParams } from '@modern-js/runtime/router';
import {
  DEFAULT_SEGMENTATION_DIF,
  getSegmentsDataById,
} from '../../routes/[id]/page.data';
import {
  IconAdd,
  IconAddCircle,
  IconRefresh,
  IconSubtract,
  IconZoomIn,
  IconZoomOut,
} from '../icons';

const DEFAULT_FRAME_RATE = 30;

const commonTailwindStyles =
  'py-2 rounded-xl shadow-md flex justify-center items-center text-black disabled:cursor-not-allowed disabled:opacity-50';
const buttonConfig = [
  {
    id: 0,
    title: 'Zoom out for longer and fewer segments',
    twStyle: 'text-3xl bg-primary hover:bg-primary-dark px-2',
    icon: <IconSubtract />,
    deltaDif: -0.1,
  },
  {
    id: 1,
    title: 'Zoom in for shorter and more segments',
    twStyle: 'text-3xl bg-primary hover:bg-primary-dark px-2',
    icon: <IconAdd />,
    deltaDif: 0.1,
  },
  {
    id: 2,
    title: 'Reset segmentation to default',
    twStyle: 'col-span-2 text-xl uppercase bg-gray-400 hover:bg-gray-500 px-2',
    icon: <p>Reset</p>,
    deltaDif: null,
  },
  // {
  //   id: 1,
  //   title: 'Zoom out a little',
  //   twStyle: 'text-md bg-gray-400 hover:bg-gray-500 px-4',
  //   icon: <IconSubtract />,
  //   deltaDif: -0.02,
  // },
  // {
  //   id: 3,
  //   title: 'Zoom in a little',
  //   twStyle: 'text-md bg-gray-400 hover:bg-gray-500 px-4',
  //   icon: <IconAdd />,
  //   deltaDif: 0.02,
  // },
];

const SegmentZoomControl = ({
  updateSegmentsCallback,
  segments,
  totalNumberOfFrames,
  ...props
}) => {
  const { id: projectId } = useParams();
  const [disableAllButtons, setDisableAllButtons] = useState(false);
  const [segmentationDif, setSegmentationDif] = useState(
    DEFAULT_SEGMENTATION_DIF,
  );

  const handleButtonClick = async (deltaDif: number | null = null) => {
    setDisableAllButtons(true);
    let newDif = segmentationDif + deltaDif!;

    if (deltaDif === null) {
      newDif = DEFAULT_SEGMENTATION_DIF;
    }

    if (newDif > 1) {
      newDif = 1;
    }

    if (newDif < 0) {
      newDif = 0;
    }

    setSegmentationDif(newDif);
    updateSegmentsCallback(
      await getSegmentsDataById(projectId, newDif)
        .then(result => {
          if (!result) {
            throw new Error('Failed to get segments');
          }
          setDisableAllButtons(false);
          return result.starts;
        })
        .catch(() => {
          return null;
        }),
    );
  };

  return (
    <div
      className={`${props.className} grid grid-cols-2 justify-center items-center gap-1`}
    >
      {buttonConfig.map(button => {
        return (
          <button
            key={`${button.id}`}
            title={`${button.title}`}
            className={`${commonTailwindStyles} ${button.twStyle}`}
            disabled={
              disableAllButtons ||
              (segmentationDif === 0 && (button.deltaDif ?? 0) < 0) ||
              (segmentationDif === 1 && (button.deltaDif ?? 0) > 0)
            }
            onClick={() => {
              handleButtonClick(button.deltaDif);
            }}
          >
            {button.icon}
          </button>
        );
      })}
    </div>
  );
};

export default SegmentZoomControl;
