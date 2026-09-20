// frontend/src/components/markdown/renderers/CodeRenderer/CodeRenderer.tsx

import {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  PrismAsync as SyntaxHighlighter,
} from 'react-syntax-highlighter';

import SafeHtmlFrame from '../../../../common/SafeHtmlFrame';

import { useLocalize } from '../../../../localization/useLocalize';

import {
  extractMarkdownCodeLanguage,
  normalizeMarkdownCodeLanguage,
} from '../../core/MarkdownCodePolicy';

import {
  MarkdownErrorBoundary,
} from '../../core/MarkdownErrorBoundary';

import {
  markdownThemeTokens,
} from '../../theme/markdownThemeTokens';

import {
  CopyButton,
} from '../shared/CopyButton';

import {
  codeHighlightDark,
  codeHighlightLight,
} from './codeHighlightTheme';

import {
  getCodeBlockWrapperClass,
  getCodeToolbarClass,
  getInlineTextStyle,
} from './codeStyles';

interface CodeRendererProps {
  theme: 'light' | 'dark';
  inline?: boolean;
  className?: string;
  children: React.ReactNode;
}

export const CodeRenderer = ({
  inline = false,
  className,
  children,
  theme,
  ...props
}: CodeRendererProps) => {
  const localize = useLocalize();

  const codeBlockRef =
    useRef<HTMLDivElement>(null);

  const toolbarRef =
    useRef<HTMLDivElement>(null);

  const codeRenderRef =
    useRef<HTMLDivElement>(null);

  const [
    isToolbarStuck,
    setIsToolbarStuck,
  ] = useState(false);

  const [
    showHtmlPreview,
    setShowHtmlPreview,
  ] = useState(false);

  const [
    codeRendered,
    setCodeRendered,
  ] = useState(false);

  const language =
    normalizeMarkdownCodeLanguage(
      extractMarkdownCodeLanguage(
        className,
      ),
    )
    || 'text';

  const codeContent = String(
    children,
  ).replace(/\n$/, '');

  const htmlPreviewAvailable =
    language === 'html';

  useEffect(() => {
    setShowHtmlPreview(false);
  }, [
    language,
    codeContent,
  ]);

  useEffect(() => {
    if (inline) {
      setCodeRendered(true);
      return;
    }

    setCodeRendered(false);

    let firstFrame = 0;
    let secondFrame = 0;

    firstFrame =
      requestAnimationFrame(() => {
        secondFrame =
          requestAnimationFrame(() => {
            if (
              codeRenderRef.current
            ) {
              setCodeRendered(true);
            }
          });
      });

    return () => {
      cancelAnimationFrame(
        firstFrame,
      );

      cancelAnimationFrame(
        secondFrame,
      );
    };
  }, [
    inline,
    language,
    codeContent,
    theme,
  ]);

  useEffect(() => {
    if (inline) {
      setIsToolbarStuck(false);
      return;
    }

    const codeBlock =
      codeBlockRef.current;

    const toolbar =
      toolbarRef.current;

    if (
      !codeBlock
      || !toolbar
    ) {
      setIsToolbarStuck(false);
      return;
    }

    let animationFrameId = 0;

    const updateStickyState = () => {
      cancelAnimationFrame(
        animationFrameId,
      );

      animationFrameId =
        requestAnimationFrame(() => {
          const blockRect =
            codeBlock
              .getBoundingClientRect();

          const toolbarRect =
            toolbar
              .getBoundingClientRect();

          const detachedFromBlockTop =
            toolbarRect.top
              - blockRect.top
            > codeBlock.clientTop + 1;

          const stillPinnedInsideBlock =
            toolbarRect.bottom
            < blockRect.bottom - 1;

          const stuck =
            detachedFromBlockTop
            && stillPinnedInsideBlock;

          setIsToolbarStuck(
            (previous) =>
              previous === stuck
                ? previous
                : stuck,
          );
        });
    };

    updateStickyState();

    document.addEventListener(
      'scroll',
      updateStickyState,
      true,
    );

    window.addEventListener(
      'resize',
      updateStickyState,
    );

    const resizeObserver =
      new ResizeObserver(
        updateStickyState,
      );

    resizeObserver.observe(
      codeBlock,
    );

    resizeObserver.observe(
      toolbar,
    );

    return () => {
      cancelAnimationFrame(
        animationFrameId,
      );

      document.removeEventListener(
        'scroll',
        updateStickyState,
        true,
      );

      window.removeEventListener(
        'resize',
        updateStickyState,
      );

      resizeObserver.disconnect();
    };
  }, [
    inline,
    language,
  ]);

  if (inline) {
    return (
      <code
        className={className}
        style={getInlineTextStyle(
          theme,
        )}
        {...props}
      >
        {children}
      </code>
    );
  }

  return (
    <div
      ref={codeBlockRef}
      className={getCodeBlockWrapperClass(
        theme,
      )}
      style={{
        borderTopLeftRadius:
          isToolbarStuck
            ? 0
            : undefined,

        borderTopRightRadius:
          isToolbarStuck
            ? 0
            : undefined,
      }}
    >
      <div
        ref={toolbarRef}
        className={getCodeToolbarClass(
          theme,
        )}
        style={{
          top:
            'var(--chat-head-bottom, 0px)',

          borderTopLeftRadius:
            isToolbarStuck
              ? 0
              : undefined,

          borderTopRightRadius:
            isToolbarStuck
              ? 0
              : undefined,
        }}
      >
        <span className="text-[10px] font-normal opacity-70">
          {language}
        </span>

        <div className="relative right-[10px] flex shrink-0 items-center gap-2">
          {htmlPreviewAvailable && (
            <button
              type="button"
              disabled={
                !codeRendered
              }
              onClick={() =>
                setShowHtmlPreview(
                  (current) =>
                    !current,
                )
              }
              className={[
                'select-none text-[10px] font-normal transition-opacity',
                codeRendered
                  ? 'cursor-pointer opacity-60 hover:opacity-100'
                  : 'cursor-default opacity-30',
              ].join(' ')}
              title={
                showHtmlPreview
                  ? localize(
                      'markdown.code.showCode',
                    )
                  : localize(
                      'markdown.code.preview',
                    )
              }
            >
              {showHtmlPreview
                ? localize(
                    'markdown.code.code',
                  )
                : localize(
                    'markdown.code.preview',
                  )}
            </button>
          )}

          <div
            aria-disabled={
              !codeRendered
            }
            className={[
              'select-none',
              codeRendered
                ? ''
                : 'pointer-events-none opacity-30',
            ].join(' ')}
          >
            <CopyButton
              content={
                codeContent
              }
              theme={
                theme
              }
            />
          </div>
        </div>
      </div>

      {showHtmlPreview && (
        <SafeHtmlFrame
          html={codeContent}
          title={localize(
            'markdown.code.previewTitle',
          )}
          allowScripts
          allowForms
          className="block h-[320px] w-full rounded-b-[16px] border-0 bg-[#ffffff]"
        />
      )}

      <div
        ref={codeRenderRef}
        className={
          showHtmlPreview
            ? 'hidden'
            : ''
        }
      >
        <MarkdownErrorBoundary
          componentName="CodeRenderer"
          fallback={(
            <pre
              className="m-0 max-h-[320px] overflow-auto whitespace-pre px-[40px] py-[10px] text-[11px] leading-[22px]"
              style={{
                backgroundColor:
                  theme === 'dark'
                    ? '#252525'
                    : '#ffffff',

                fontFamily:
                  markdownThemeTokens
                    .font
                    .code,
              }}
            >
              <code>
                {codeContent}
              </code>
            </pre>
          )}
        >
          <SyntaxHighlighter
            language={
              language
            }
            style={
              theme === 'dark'
                ? codeHighlightDark
                : codeHighlightLight
            }
            customStyle={{
              backgroundColor:
                theme === 'dark'
                  ? '#252525'
                  : '#ffffff',

              padding:
                '10px 40px',

              margin: 0,

              borderRadius:
                '0 0 16px 16px',

              border:
                'none',

              maxHeight:
                '320px',

              overflowX:
                'auto',

              overflowY:
                'auto',

              whiteSpace:
                'pre',

              scrollbarWidth:
                'thin',

              fontFamily:
                markdownThemeTokens
                  .font
                  .code,

              fontSize:
                '11px',

              lineHeight:
                '22px',

              fontWeight:
                400,

              fontStyle:
                'normal',

              textDecoration:
                'none',
            }}
            codeTagProps={{
              style: {
                fontFamily:
                  markdownThemeTokens
                    .font
                    .code,

                fontSize:
                  '11px',

                lineHeight:
                  '22px',

                fontWeight:
                  400,

                fontStyle:
                  'normal',

                textDecoration:
                  'none',
              },
            }}
            PreTag="div"
          >
            {codeContent}
          </SyntaxHighlighter>
        </MarkdownErrorBoundary>
      </div>
    </div>
  );
};