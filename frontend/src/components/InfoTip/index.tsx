import * as Tooltip from '@radix-ui/react-tooltip';
import { IconQuestionCircleFill } from '../icons';

const InfoTip = ({ children }) => (
  <Tooltip.Provider delayDuration={0}>
    <Tooltip.Root>
      <Tooltip.Trigger>
        <span className="text-primary hover:text-primary-dark">
          <IconQuestionCircleFill />
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content>
          <div className="bg-gray-200 text-gray-800 text-sm p-4 rounded-xl">
            {children}
          </div>
          <Tooltip.Arrow className="fill-gray-200" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
);

export default InfoTip;
