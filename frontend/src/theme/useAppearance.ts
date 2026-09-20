import { useContext } from 'react';

import {
  AppearanceContext,
  type AppearanceContextValue,
} from './AppearanceProvider';

export function useAppearance(): AppearanceContextValue {
  const context = useContext(
    AppearanceContext,
  );

  if (!context) {
    throw new Error(
      'useAppearance must be used within AppearanceProvider',
    );
  }

  return context;
}
