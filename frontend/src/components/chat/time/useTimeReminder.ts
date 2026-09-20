import { useContext } from 'react';
import { TimeReminderContext } from './TimeReminderProvider';

export function useTimeReminder() {
  const value = useContext(TimeReminderContext);
  if (!value) {
    throw new Error('useTimeReminder must be used inside TimeReminderProvider');
  }
  return value;
}
