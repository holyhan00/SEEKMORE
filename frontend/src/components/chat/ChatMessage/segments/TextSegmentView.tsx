import { useAppearance } from '../../../../theme/useAppearance';
                                                                        
import MarkdownViewer from '../../../markdown/MarkdownViewer';
import type { AssistantTextSegment } from './runtime-display.types';
import ReasoningDisclosure from './ReasoningDisclosure';

type Props = {
  segment: AssistantTextSegment;

  loading: boolean;
  onLink?: (href: string) => boolean;
};

export default function TextSegmentView({
  segment,
    loading,
  onLink,
}: Props) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const textColor = isDarkTheme ? '#ffffff' : '#1a1a1a';

  if (!segment.markdown.trim()) {
    return null;
  }

  if (segment.role === 'commentary') {
    return (
      <ReasoningDisclosure
        markdown={segment.markdown}

        streaming={loading && !segment.final}
        onLink={onLink}
      />
    );
  }

  return (
    <div className="mb-[15px] select-text">
      <div
        style={{
          color: textColor,
          fontSize: '12px',
          lineHeight: '21px',
          transition: 'opacity 0.2s ease',
          opacity: loading && !segment.final ? 0.72 : 1,
        }}
      >
        <MarkdownViewer
          content={segment.markdown.trim()}
          style={{
            color: textColor,
            fontSize: 'inherit',
            lineHeight: 'inherit',
          }}
          theme={isDarkTheme ? 'dark' : 'light'}
          partialRender={loading && !segment.final}
          onLink={onLink}
        />
      </div>
    </div>
  );
}