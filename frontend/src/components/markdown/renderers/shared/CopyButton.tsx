import { resolveAssetUrl } from '../../../../utils/asset-url';
import { useLocalize } from '../../../../localization/useLocalize';
                                                                         

import {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  copyText,
} from '../../../../runtime/clipboard/clipboard.service';
import IconButton from '../../../ui/IconButton';

interface CopyButtonProps {
  content: string;
  theme: 'light' | 'dark';
}

type CopyState =
  | 'idle'
  | 'copied'
  | 'error';

export const CopyButton = ({
  content,
}: CopyButtonProps) => {
  const localize = useLocalize();

  const [
    state,
    setState,
  ] = useState<CopyState>('idle');

  const resetTimerRef =
    useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (
        resetTimerRef.current
        !== null
      ) {
        window.clearTimeout(
          resetTimerRef.current,
        );
      }
    };
  }, []);

  const handleCopy = async () => {
    const result =
      await copyText(content);

    setState(
      result.ok
        ? 'copied'
        : 'error',
    );

    if (
      resetTimerRef.current
      !== null
    ) {
      window.clearTimeout(
        resetTimerRef.current,
      );
    }

    resetTimerRef.current =
      window.setTimeout(() => {
        resetTimerRef.current =
          null;

        setState('idle');
      }, 2_000);
  };

  const getLabel = (): string => {
    if (state === 'copied') {
      return localize('common.copied');
    }

    if (state === 'error') {
      return localize('common.copyFailed');
    }

    return localize('common.copy');
  };

  const label =
    getLabel();

  const iconSource =
    state === 'copied'
      ? resolveAssetUrl('/icons/copyed.svg')
      : resolveAssetUrl('/icons/copy.svg');

  return (
    <div
      data-desktop-no-drag
      className="flex shrink-0 items-center"
    >
      <IconButton

        title={label}
        aria-label={label}
        onClick={() => {
          void handleCopy();
        }}
        icon={
          <img
            src={iconSource}
            style={{
              height: '1.1rem',
              userSelect: 'none',
            }}
            draggable={false}
            alt={label}
          />
        }
      />
    </div>
  );
};