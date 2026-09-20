import { useLocalize } from '../../../../localization/useLocalize';
                                                       

import { cn } from '../../../../lib/utils';
import { useMemo, useState } from 'react';

export default function BubbleUser({
  text,
  }: {
  text: string;

}) {
  const localize = useLocalize();
  const [expanded, setExpanded] = useState(false);
  const MAX_LINES = 5;

  const normalizedText = String(text ?? '');

  const shouldCollapse = useMemo(() => {
    return normalizedText.split('\n').length > MAX_LINES || normalizedText.length > 400;
  }, [normalizedText]);

  const hasText = normalizedText.trim().length > 0;

  return (
    <div
      className={cn(
        'text-[12px] leading-[2.2rem] py-[0.3rem] px-[0.8rem] min-h-[2.125rem] rounded-[1.6rem] text-left break-words inline-block max-w-[75%]',
        'bg-[#E2E2E2] dark:bg-[#252525]'
      )}
      style={{
        whiteSpace: 'normal',
        wordBreak: 'break-word',
      }}
    >
      <div className="flex flex-col">
        {hasText && (
          <div
            className={[
              'whitespace-pre-wrap transition-all duration-200',
              !expanded && shouldCollapse ? 'line-clamp-5' : '',
              shouldCollapse ? 'cursor-pointer hover:opacity-90' : '',
            ].join(' ')}
            onClick={() => {
              if (shouldCollapse) {
                setExpanded((v) => !v);
              }
            }}
            title={shouldCollapse ? (expanded ? localize('chat.message.collapse') : localize('chat.message.expand')) : undefined}
          >
            {normalizedText}
          </div>
        )}
      </div>
    </div>
  );
}