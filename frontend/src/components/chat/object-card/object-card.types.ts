import type {
  ReactNode,
} from 'react';

export type ObjectCardLayout =
  | 'compact'
  | 'wide';

export interface ObjectCardProps {
  title: string;
  filename?: string;
  size?: string | number;
  statusText?: string;
  fileType?: string;
  onClick?: () => void;

  layout?: ObjectCardLayout;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  interactive?: boolean;
}
