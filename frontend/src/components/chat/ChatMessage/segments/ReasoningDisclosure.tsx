import { useAppearance } from '../../../../theme/useAppearance';
import { useLocalize } from '../../../../localization/useLocalize';
                                                                            
import { memo, useEffect, useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import MarkdownViewer from '../../../markdown/MarkdownViewer';

type Props = {
  markdown: string;

  streaming: boolean;
  onLink?: (href: string) => boolean;
};

function ReasoningDisclosure({ markdown, streaming, onLink }: Props) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();
  const [open, setOpen] = useState(streaming);
  useEffect(() => { if (streaming) setOpen(true); }, [streaming]);
  if (!markdown.trim()) return null;
  return (
    <section className="my-2 overflow-hidden rounded-[10px] bg-[#ffffff] text-neutral-800">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-neutral-500 hover:bg-neutral-50">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Brain size={14} className={streaming ? 'animate-pulse' : ''} />
        <span>{streaming ? localize('chat.reasoning.thinking') : localize('chat.reasoning.processed')}</span>
        {streaming && <span className="ml-auto flex gap-1" aria-label={localize('chat.reasoning.streaming')}><i className="h-1 w-1 animate-pulse rounded-full bg-current" /><i className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:120ms]" /><i className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:240ms]" /></span>}
      </button>
      {open && (
        <div className="bg-neutral-50 px-3 py-2 text-[10px] leading-7 text-neutral-600">
          <MarkdownViewer content={markdown.trim()} theme={isDarkTheme ? 'dark' : 'light'} partialRender={streaming} onLink={onLink} style={{ color: 'inherit', fontSize: 'inherit', lineHeight: 'inherit' }} />
        </div>
      )}
    </section>
  );
}

export default memo(ReasoningDisclosure);
