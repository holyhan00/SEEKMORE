import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';

export const streamRemarkPlugins: PluggableList = [
  remarkGfm,
  remarkBreaks,
];

export const finalRemarkPlugins: PluggableList = [
  remarkGfm,
  remarkMath,
  remarkBreaks,
];
