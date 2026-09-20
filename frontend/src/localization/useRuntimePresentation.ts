import { useCallback } from 'react';
import type {
  RuntimeActivity,
  RuntimePresentation,
  RuntimeStep,
} from '../components/chat/runtime/events/runtime-events.types';
import { useLocalize } from './useLocalize';

export function useRuntimePresentation() {
  const t = useLocalize();

  const toolName = useCallback((toolId: string, fallback?: string | null) => {
    const canonical = String(toolId ?? '').trim();
    if (!canonical) return fallback?.trim() || '';
    return t(`tools.${canonical}.name`, {
      defaultValue: fallback?.trim() || canonical,
    });
  }, [t]);

  const presentationText = useCallback((
    presentation: RuntimePresentation | null | undefined,
    fallback: string,
  ) => {
    if (!presentation?.key) return fallback;
    const params = { ...(presentation.params ?? {}) } as Record<string, unknown>;
    const toolId = typeof params.toolId === 'string' ? params.toolId : null;
    if (toolId) {
      params.tool = toolName(toolId, toolId);
      delete params.toolId;
    }
    return t(presentation.key, {
      ...params,
      defaultValue: fallback,
    });
  }, [t, toolName]);

  const activityTitle = useCallback((activity: RuntimeActivity) => (
    presentationText(activity.presentation, activity.title)
  ), [presentationText]);

  const activitySummary = useCallback((activity: RuntimeActivity) => (
    presentationText(activity.summaryPresentation, activity.summary ?? '')
  ), [presentationText]);

  const stepTitle = useCallback((step: RuntimeStep) => (
    presentationText(step.presentation, step.title ?? '')
  ), [presentationText]);

  const statusLabel = useCallback((status: RuntimeActivity['status']) => (
    t(`runtime.status.${status}`, { defaultValue: status })
  ), [t]);

  return {
    activityTitle,
    activitySummary,
    stepTitle,
    statusLabel,
    toolName,
    presentationText,
  };
}
