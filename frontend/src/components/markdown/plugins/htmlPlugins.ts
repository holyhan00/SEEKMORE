import rehypeKatex from 'rehype-katex';
import type { PluggableList } from 'unified';

export const streamRehypePlugins: PluggableList = [];

export const finalRehypePlugins: PluggableList = [
  [rehypeKatex, { output: 'mathml' }],
];
