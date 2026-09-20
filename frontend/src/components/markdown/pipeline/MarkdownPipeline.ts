import type { PluggableList } from 'unified';
import type { MarkdownRenderPhase } from '../model/markdown.types';
import {
  finalRehypePlugins,
  streamRehypePlugins,
} from '../plugins/htmlPlugins';
import {
  finalRemarkPlugins,
  streamRemarkPlugins,
} from '../plugins/markdownPlugins';
import { autoCompleteMarkdown } from '../utils/markdownUtils';

export interface MarkdownPipeline {
  content: string;
  remarkPlugins: PluggableList;
  rehypePlugins: PluggableList;
}

export function createMarkdownPipeline(
  content: string,
  phase: MarkdownRenderPhase,
): MarkdownPipeline {
  if (phase === 'stream') {
    return {
      content: autoCompleteMarkdown(content),
      remarkPlugins: streamRemarkPlugins,
      rehypePlugins: streamRehypePlugins,
    };
  }

  return {
    content,
    remarkPlugins: finalRemarkPlugins,
    rehypePlugins: finalRehypePlugins,
  };
}
