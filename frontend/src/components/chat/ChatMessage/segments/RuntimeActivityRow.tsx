
import { cn } from '../../../../lib/utils';
import { memo, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Circle, CircleDashed, Check, X } from 'lucide-react';
import type { RuntimeActivity } from '../../runtime/events/runtime-events.types';
import type { RuntimeApprovalDecision } from '../../runtime/approval/runtimeApprovalClient';
import ApprovalCard from './cards/ApprovalCard';
import ClarificationCard from './cards/ClarificationCard';
import ToolCallRow from './cards/ToolCallRow';
import { useRuntimePresentation } from '../../../../localization/useRuntimePresentation';

type Props = { activity: RuntimeActivity;  onApprovalDecision?: (approvalId: string, decision: RuntimeApprovalDecision, taskRunId?: string) => void };

function RuntimeActivityRow({ activity, onApprovalDecision }: Props) {
  const { activityTitle, activitySummary, toolName } = useRuntimePresentation();
  const localizedActivity = useMemo(() => ({
    ...activity,
    title: activityTitle(activity),
    summary: activitySummary(activity) || null,
    target: activity.target?.kind === 'tool'
      ? {
          ...activity.target,
          label: toolName(activity.operation, activity.target.label),
        }
      : activity.target,
  }), [activity, activityTitle, activitySummary, toolName]);

  if (localizedActivity.kind === 'tool') return <ToolCallRow activity={localizedActivity}  />;
  if (localizedActivity.kind === 'approval') {
    if (localizedActivity.status !== 'waiting') return null;
    return <ApprovalCard activity={localizedActivity}  onDecision={onApprovalDecision} />;
  }
  if (localizedActivity.kind === 'clarification') return <ClarificationCard activity={localizedActivity}  />;
  return <GenericActivity activity={localizedActivity}  />;
}

function GenericActivity({ activity }: { activity: RuntimeActivity;  }) {
  const [expanded, setExpanded] = useState(false);
  const detail = activity.detail ?? null;
  const hasDetail = Boolean(activity.summary || detail || activity.evidenceRefs.length || activity.progress);
  const detailText = useMemo(() => structuredDetail(detail), [detail]);
  const running = activity.status === 'running' || activity.status === 'queued';
  const failed = activity.status === 'failed' || activity.status === 'blocked';
  const icon = running ? <CircleDashed size={13} className="animate-spin" /> : failed ? <X size={13} /> : activity.status === 'succeeded' ? <Check size={13} /> : <Circle size={12} />;
  return (
    <div className={cn("my-1 text-xs", 'text-neutral-500 dark:text-neutral-400')} data-activity-id={activity.activityId}>
      <button type="button" disabled={!hasDetail} onClick={() => hasDetail && setExpanded((value) => !value)} className="flex w-full items-center gap-2 py-1 text-left hover:opacity-80">
        <span className={failed ? 'text-red-500' : running ? 'text-blue-500' : ''}>{icon}</span>
        <span className="truncate">{activity.title}</span>
        {activity.summary && !expanded && <span className="truncate opacity-55">— {activity.summary.slice(0, 120)}</span>}
        {activity.progress?.total != null && <span className="ml-auto text-[10px] opacity-55">{activity.progress.completed}/{activity.progress.total}</span>}
        {hasDetail && (expanded ? <ChevronDown size={12} className="ml-auto opacity-45" /> : <ChevronRight size={12} className="ml-auto opacity-45" />)}
      </button>
      {expanded && hasDetail && <div className="ml-5 max-h-56 overflow-y-auto rounded-[10px] bg-[#ffffff] p-3 text-neutral-600">{detailText && <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 opacity-80">{detailText}</pre>}{activity.evidenceRefs.length > 0 && <div className="mt-1 text-[10px] opacity-50">{activity.evidenceRefs.slice(0, 6).join(', ')}</div>}</div>}
    </div>
  );
}

function structuredDetail(value: Record<string, unknown> | null): string {
  if (!value) return '';
  const safe = Object.fromEntries(Object.entries(value).filter(([key]) => !SENSITIVE.has(key.toLowerCase())));
  if (!Object.keys(safe).length) return '';
  try { return JSON.stringify(safe, null, 2); } catch { return ''; }
}
const SENSITIVE = new Set(['authorization','cookie','token','accesstoken','refreshtoken','password','secret','apikey']);
export default memo(RuntimeActivityRow);
