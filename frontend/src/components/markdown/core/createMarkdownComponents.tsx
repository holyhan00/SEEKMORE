import React from 'react';
import type { Components } from 'react-markdown';
import {
  extractMarkdownCodeLanguage,
  normalizeMarkdownCodeLanguage,
} from './MarkdownCodePolicy';
import {
  isExternalMarkdownHref,
  normalizeMarkdownHref,
  openMarkdownHref,
} from './MarkdownLinkPolicy';
import { MermaidBlockGate } from './MermaidBlockGate';
import type {
  MarkdownRenderPhase,
  MarkdownTheme,
} from '../model/markdown.types';
import { CodeRenderer } from '../renderers/CodeRenderer/CodeRenderer';
import MermaidRenderer from '../renderers/MermaidRenderer';
import { TextBlockRenderer } from '../renderers/TextBlockRenderer/TextBlockRenderer';
import {
  getMarkdownThemePalette,
  markdownThemeTokens,
} from '../theme/markdownThemeTokens';

type MarkdownAnchorProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href?: string;
  children?: React.ReactNode;
  node?: unknown;
};

type MarkdownCodeProps = React.HTMLAttributes<HTMLElement> & {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
  node?: unknown;
};

function joinClassNames(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(' ');
}

function toPlainText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(toPlainText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(value)) {
    return toPlainText(value.props.children);
  }
  return '';
}

const TEXT_BLOCK_LANGUAGES = new Set([
  'text',
  'plaintext',
  'plain-text',
  'plain',
  'txt',
  'prompt',
]);

function toMermaidSource(language: string, text: string): string | null {
  if (language === 'mermaid') return text;

  if (language === 'sequence') {
    return /^sequenceDiagram\b/i.test(text)
      ? text
      : `sequenceDiagram\n${text}`;
  }

  if (language === 'gantt') {
    return /^gantt\b/i.test(text)
      ? text
      : `gantt\n${text}`;
  }

  if (language === 'flowchart') {
    return /^(?:flowchart|graph)\b/i.test(text)
      ? text
      : `flowchart LR\n${text}`;
  }

  return null;
}

function renderCodeBlock(
  language: string,
  text: string,
  theme: MarkdownTheme,
  phase: MarkdownRenderPhase,
) {
  const className = language ? `language-${language}` : undefined;
  const mermaidSource = toMermaidSource(language, text);

  if (TEXT_BLOCK_LANGUAGES.has(language)) {
    return (
      <TextBlockRenderer
        content={text}
        theme={theme}
        kind={language === 'prompt' ? 'prompt' : 'text'}
      />
    );
  }

  if (mermaidSource !== null) {
    return (
      <MermaidBlockGate phase={phase} theme={theme}>
        <MermaidRenderer code={mermaidSource} theme={theme} />
      </MermaidBlockGate>
    );
  }

  return (
    <CodeRenderer inline={false} className={className} theme={theme}>
      {text}
    </CodeRenderer>
  );
}

export function createMarkdownComponents({
  theme,
  phase,
  onLink,
}: {
  theme: MarkdownTheme;
  phase: MarkdownRenderPhase;
  onLink?: (href: string) => void | boolean;
}): Components {
  const palette = getMarkdownThemePalette(theme);

  const headingBorderStyle = {
    borderColor: palette.headingBorder,
  };

  const listClassName =
    'my-[10px] pl-[22px] text-[11px] leading-[19px] '
    + '[&_ul]:my-[3px] [&_ol]:my-[3px] [&_ul]:pl-[18px] [&_ol]:pl-[18px] '
    + '[&_ol]:list-[lower-roman] [&_ol_ol]:list-[lower-alpha]';

  return {
    h1: ({ node: _node, children, className, style, ...props }) => (
      <h1
        className={joinClassNames(
          'mt-[18px] mb-[10px] pb-[6px] text-[14px] font-semibold leading-[22px] first:mt-0',
          className,
        )}
        style={{ ...headingBorderStyle, ...style }}
        {...props}
      >
        {children}
      </h1>
    ),
    h2: ({ node: _node, children, className, style, ...props }) => (
      <h2
        className={joinClassNames(
          'mt-[17px] mb-[9px]  pb-[5px] text-[13px] font-semibold leading-[21px] first:mt-0',
          className,
        )}
        style={{ ...headingBorderStyle, ...style }}
        {...props}
      >
        {children}
      </h2>
    ),
    h3: ({ node: _node, children, className, ...props }) => (
      <h3
        className={joinClassNames(
          'mt-[16px] mb-[7px] text-[12px] font-semibold leading-[20px] first:mt-0',
          className,
        )}
        {...props}
      >
        {children}
      </h3>
    ),
    h4: ({ node: _node, children, className, ...props }) => (
      <h4
        className={joinClassNames(
          'mt-[14px] mb-[6px] text-[11px] font-semibold leading-[19px] first:mt-0',
          className,
        )}
        {...props}
      >
        {children}
      </h4>
    ),
    h5: ({ node: _node, children, className, ...props }) => (
      <h5
        className={joinClassNames(
          'mt-[13px] mb-[5px] text-[11px] font-semibold leading-[18px] first:mt-0',
          className,
        )}
        {...props}
      >
        {children}
      </h5>
    ),
    h6: ({ node: _node, children, className, style, ...props }) => (
      <h6
        className={joinClassNames(
          'mt-[13px] mb-[5px] text-[10px] font-semibold leading-[17px] first:mt-0',
          className,
        )}
        style={{ color: palette.mutedText, ...style }}
        {...props}
      >
        {children}
      </h6>
    ),
    p: ({ node: _node, children, className, ...props }) => (
      <p
        className={joinClassNames(
          'my-[10px] text-[11px] font-normal leading-[19px] first:mt-0 last:mb-0',
          className,
        )}
        {...props}
      >
        {children}
      </p>
    ),
    strong: ({ node: _node, children, className, ...props }) => (
      <strong
        className={joinClassNames('font-semibold', className)}
        {...props}
      >
        {children}
      </strong>
    ),
    em: ({ node: _node, children, className, ...props }) => (
      <em
        className={joinClassNames('italic', className)}
        {...props}
      >
        {children}
      </em>
    ),
    del: ({ node: _node, children, className, style, ...props }) => (
      <del
        className={joinClassNames('decoration-[1px]', className)}
        style={{ color: palette.mutedText, ...style }}
        {...props}
      >
        {children}
      </del>
    ),
    blockquote: ({ node: _node, children, className, style, ...props }) => (
      <blockquote
        className={joinClassNames(
          'my-[12px] border-l-[0.5px] py-[1px] pl-[12px] pr-[4px] text-[11px] leading-[19px] '
          + '[&>p]:my-[6px] [&>p:first-child]:mt-0 [&>p:last-child]:mb-0',
          className,
        )}
        style={{
          borderColor: palette.quoteBorder,
          color: palette.quoteText,
          ...style,
        }}
        {...props}
      >
        {children}
      </blockquote>
    ),
    ul: ({ node: _node, children, className, ...props }) => (
      <ul
        className={joinClassNames(listClassName, 'list-disc', className)}
        {...props}
      >
        {children}
      </ul>
    ),
    ol: ({ node: _node, children, className, ...props }) => (
      <ol
        className={joinClassNames(listClassName, 'list-decimal', className)}
        {...props}
      >
        {children}
      </ol>
    ),
    li: ({ node: _node, children, className, ...props }) => (
      <li
        className={joinClassNames(
          'my-[4px] pl-[2px] text-[11px] leading-[19px] marker:text-current '
          + '[&>p]:my-[4px] [&>p:first-child]:mt-0 [&>p:last-child]:mb-0',
          className,
        )}
        {...props}
      >
        {children}
      </li>
    ),
    input: ({ node: _node, className, type, ...props }) => (
      <input
        type={type}
        className={joinClassNames(
          type === 'checkbox'
            ? 'mr-[7px] h-[13px] w-[13px] shrink-0 translate-y-[1px] accent-[#1071ff]'
            : undefined,
          className,
        )}
        {...props}
      />
    ),
    table: ({ node: _node, children, className, style, ...props }) => (
      <div
        className="my-[14px] w-full max-w-full overflow-x-auto rounded-[10px] border-[0.5px]"
        style={{ borderColor: palette.tableBorder }}
      >
        <table
          className={joinClassNames(
            'w-full border-collapse border-spacing-0 text-left text-[11px] leading-[18px]',
            className,
          )}
          style={style}
          {...props}
        >
          {children}
        </table>
      </div>
    ),
    thead: ({ node: _node, children, className, ...props }) => (
      <thead
        className={joinClassNames('font-semibold', className)}
        {...props}
      >
        {children}
      </thead>
    ),
    tbody: ({ node: _node, children, className, ...props }) => (
      <tbody className={className} {...props}>
        {children}
      </tbody>
    ),
    tr: ({ node: _node, children, className, style, ...props }) => (
      <tr
        className={joinClassNames(
          theme === 'dark'
            ? 'even:bg-[#232323]'
            : 'even:bg-[#fafafa]',
          '[&:last-child>td]:border-b-0',
          className,
        )}
        style={style}
        {...props}
      >
        {children}
      </tr>
    ),
    th: ({ node: _node, children, className, style, ...props }) => (
      <th
        className={joinClassNames(
          'border-r-[0.5px] border-b-[0.5px] px-[12px] py-[8px] text-left align-top text-[11px] font-semibold leading-[18px] whitespace-normal break-words [overflow-wrap:anywhere] last:border-r-0',
          className,
        )}
        style={{
          borderColor: palette.tableBorder,
          backgroundColor: palette.tableHeaderBg,
          color: palette.text,
          ...style,
        }}
        {...props}
      >
        {children}
      </th>
    ),
    td: ({ node: _node, children, className, style, ...props }) => (
      <td
        className={joinClassNames(
          'border-r-[0.5px] border-b-[0.5px] px-[12px] py-[8px] align-top text-[11px] leading-[18px] whitespace-normal break-words [overflow-wrap:anywhere] last:border-r-0',
          className,
        )}
        style={{
          borderColor: palette.tableBorder,
          color: palette.text,
          ...style,
        }}
        {...props}
      >
        {children}
      </td>
    ),
    hr: ({ node: _node, className, style, ...props }) => (
      <hr
        className={joinClassNames('my-[16px] border-0 border-t-[0.5px]', className)}
        style={{ borderColor: palette.headingBorder, ...style }}
        {...props}
      />
    ),
    a: ({
      node: _node,
      href,
      children,
      className,
      style,
      ...props
    }: MarkdownAnchorProps) => {
      const originalHref = typeof href === 'string' ? href : '';
      const resolvedHref = normalizeMarkdownHref(originalHref);
      const isExternal = resolvedHref
        ? isExternalMarkdownHref(resolvedHref)
        : false;

      const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        event.stopPropagation();

        if (!resolvedHref) {
          console.warn('[Markdown] blocked unsafe link:', originalHref);
          return;
        }

        if (onLink) {
          const handled = onLink(originalHref || resolvedHref);
          if (handled === true) return;
        }

        void openMarkdownHref(resolvedHref);
      };

      return (
        <a
          href={resolvedHref || undefined}
          onClick={handleClick}
          className={joinClassNames(
            'font-medium underline decoration-current underline-offset-[2px] transition-opacity hover:opacity-80',
            className,
          )}
          style={{ color: palette.linkText, ...style }}
          {...props}
          {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {children}
        </a>
      );
    },
    img: ({ node: _node, className, style, alt, ...props }) => (
      <img
        alt={alt || ''}
        loading="lazy"
        decoding="async"
        className={joinClassNames(
          'my-[12px] h-auto max-w-full rounded-[10px] border-[0.5px] object-contain',
          className,
        )}
        style={{ borderColor: palette.imageBorder, ...style }}
        {...props}
      />
    ),
    pre: ({ node: _node, children, className, ...props }) => (
      <pre
        className={joinClassNames(
          'm-0 max-w-full whitespace-pre-wrap '
          + '[&>code]:my-[14px] [&>code]:block [&>code]:max-w-full [&>code]:overflow-x-auto '
          + '[&>code]:whitespace-pre [&>code]:rounded-[10px] [&>code]:border-[0.5px] [&>code]:px-[12px] [&>code]:py-[10px] '
          + '[&>code]:text-[10px] [&>code]:leading-[18px] '
          + (theme === 'dark'
            ? '[&>code]:border-[#2f2f2f] [&>code]:bg-[#252525] [&>code]:text-[#f3f4f6]'
            : '[&>code]:border-[#e5e7eb] [&>code]:bg-[#f8f8f8] [&>code]:text-[#111827]'),
          className,
        )}
        {...props}
      >
        {children}
      </pre>
    ),
    code: ({
      node: _node,
      inline,
      className,
      children,
      style,
      ...props
    }: MarkdownCodeProps) => {
      const rawLanguage = extractMarkdownCodeLanguage(className);
      const language = normalizeMarkdownCodeLanguage(rawLanguage);
      const text = toPlainText(children).replace(/\n$/, '');

      if (inline || !language) {
        return (
          <code
            className={joinClassNames(
              'rounded-[6px] px-[4px] py-[1px] text-[10px] font-normal leading-[17px]',
              className,
            )}
            style={{
              backgroundColor: palette.inlineCodeBg,
              color: palette.text,
              fontFamily: markdownThemeTokens.font.code,
              ...style,
            }}
            {...props}
          >
            {children}
          </code>
        );
      }

      return renderCodeBlock(language, text, theme, phase);
    },
  };
}