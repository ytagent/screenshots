import type { ReactElement } from 'react';
import { useCallback } from 'react';
import useCall from '../../hooks/useCall';
import useStore from '../../hooks/useStore';
import ScreenshotsButton from '../../ScreenshotsButton';

export default function LongScreenshot(): ReactElement {
  const { bounds, lang } = useStore();
  const call = useCall();

  const onClick = useCallback(() => {
    if (!bounds) {
      return;
    }
    call('onLongScreenshot', bounds);
  }, [bounds, call]);

  return (
    <ScreenshotsButton
      title={lang.operation_long_screenshot_title}
      icon="icon-scrollshot"
      onClick={onClick}
    />
  );
}
