import { useContext } from 'react';
import { DesktopRuntimeContext } from './DesktopRuntimeProvider';

export function useDesktopRuntime() {
  return useContext(DesktopRuntimeContext);
}
