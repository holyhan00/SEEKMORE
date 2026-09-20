import { resolveAssetUrl } from '../../../../utils/asset-url';
import { useAppearance } from '../../../../theme/useAppearance';
import { useLocalize } from '../../../../localization/useLocalize';
                                                                 

import { memo, useMemo } from 'react';

import AuroraBorder from '../../../ui/AuroraBorder';
import type {
  ActiveWorkflowSnapshot,
  WorkflowPhaseStatus,
  WorkflowPhaseView,
} from './workflow.types';

type Props = {
  snapshot: ActiveWorkflowSnapshot;

  expanded: boolean;
};

type FlattenedPhase = {
  phase: WorkflowPhaseView;
  depth: number;
};

const PHASE_MARK: Record<WorkflowPhaseStatus, string> = {
  PENDING: '○',
  ACTIVE: '●',
  COMPLETED: '✓',
  BLOCKED: '!',
  FAILED: '×',
  SKIPPED: '–',
  CANCELLED: '–',
};

const PHASE_LABEL: Record<WorkflowPhaseStatus, string> = {
  PENDING: 'workflow.status.waiting',
  ACTIVE: 'workflow.status.inProgress',
  COMPLETED: 'workflow.status.completed',
  BLOCKED: 'workflow.status.blocked',
  FAILED: 'workflow.status.failed',
  SKIPPED: 'workflow.status.skipped',
  CANCELLED: 'workflow.status.cancelled',
};

function WorkflowLine({
  snapshot,
    expanded,
}: Props) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();
  const phases = useMemo(
    () => [...snapshot.phases].sort(comparePhase),
    [snapshot.phases],
  );

  const currentPhase = useMemo(() => {
    const currentId =
      snapshot.currentPhase?.id
      ?? snapshot.run.currentPhaseId;

    if (currentId) {
      const current = phases.find(
        (phase) => phase.id === currentId,
      );
      if (current) return current;
    }

    return (
      phases.find(
        (phase) => phase.status === 'ACTIVE',
      )
      ?? phases.find(
        (phase) => phase.status === 'BLOCKED',
      )
      ?? phases.find(
        (phase) => phase.status === 'PENDING',
      )
      ?? phases[phases.length - 1]
      ?? null
    );
  }, [
    phases,
    snapshot.currentPhase?.id,
    snapshot.run.currentPhaseId,
  ]);

  const flattened = useMemo(
    () => flattenPhases(phases),
    [phases],
  );

  const displayed = useMemo<FlattenedPhase[]>(
    () => {
      if (expanded) return flattened;
      return currentPhase
        ? [{ phase: currentPhase, depth: 0 }]
        : [];
    }, [currentPhase, expanded, flattened],
  );

  const completed = useMemo(
    () =>
      phases.filter(
        (phase) =>
          phase.status === 'COMPLETED'
          || phase.status === 'SKIPPED',
      ).length,
    [phases],
  );

  if (phases.length === 0) {
    return null;
  }

  const title =
    snapshot.run.title?.trim()
    || localize('workflow.progress');

  const progressText =
    `${completed} / ${phases.length}`;

  const taskIconSrc = isDarkTheme
    ? resolveAssetUrl('/icons/white/task1.svg')
    : resolveAssetUrl('/icons/task.svg');

  return (
    <div className="w-full">
      <section
        aria-label={title}
        aria-expanded={expanded}
        data-workflow-id={snapshot.run.id}
        className={`
          flex
          max-h-[180px]
          w-full
          flex-col
          overflow-hidden
          rounded-b-none
          rounded-t-[20px]
          shadow-sm
          ${
            'bg-surface-item text-theme-input  '
          }
        `}
      >
        <div className="flex shrink-0 items-start gap-[8px] px-[20px] pb-[5px] pt-[5px]">
          <img
            src={taskIconSrc}
            alt=""
            aria-hidden="true"
            className="mt-[3px] h-[14px] w-[14px] shrink-0 object-contain opacity-70"
          />

          <span
            className="min-w-0 flex-1 truncate text-[10px] font-medium leading-[20px]"
            title={title}
          >
            {title}
          </span>

          <span className="shrink-0 pt-[2px] text-[9px] opacity-55">
            {progressText}
          </span>
        </div>

        <div className="min-h-0 overflow-y-auto px-[10px] pb-[8px]">
          <div className="flex flex-col gap-[3px] [&>*:last-child]:mb-[20px]">
            {displayed.map(({ phase, depth }) => (
              <WorkflowPhaseRow
                key={phase.id}
                phase={phase}

                depth={depth}
                isCurrent={phase.id === currentPhase?.id}
                runStatus={snapshot.run.status}
                waitReason={snapshot.run.waitReason}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function WorkflowPhaseRow({
  phase,
    depth,
  isCurrent,
  runStatus,
  waitReason,
}: {
  phase: WorkflowPhaseView;

  depth: number;
  isCurrent: boolean;
  runStatus: ActiveWorkflowSnapshot['run']['status'];
  waitReason: ActiveWorkflowSnapshot['run']['waitReason'];
}) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();
  const waitingCurrent =
    isCurrent
    && runStatus === 'WAITING';

  const blockedCurrent =
    isCurrent
    && runStatus === 'BLOCKED';

  const active =
    phase.status === 'ACTIVE'
    && runStatus === 'RUNNING';

  const completed =
    phase.status === 'COMPLETED';

  const muted =
    phase.status === 'PENDING'
    || phase.status === 'SKIPPED'
    || phase.status === 'CANCELLED';

  const content = (
    <div
      className={`
        flex
        min-h-[18px]
        items-start
        gap-[3px]
        rounded-[8px]
        bg-transparent
        px-[8px]
        py-[6px]
        text-[10px]
        ${muted ? 'opacity-55' : ''}
      `}
    >
      <span className="mt-[1px] w-[15px] shrink-0 text-center opacity-70">
        {waitingCurrent || blockedCurrent ? '!' : PHASE_MARK[phase.status]}
      </span>

      <span
        className={`
          min-w-0
          flex-1
          break-words
          leading-[18px]
          ${completed ? 'opacity-40' : ''}
        `}
      >
        {phase.title}
      </span>

      <span className="shrink-0 pt-[1px] text-[9px] opacity-55">
        {waitingCurrent
          ? localize(waitReasonKey(waitReason))
          : blockedCurrent
            ? localize('workflow.blocked')
            : localize(PHASE_LABEL[phase.status])}
      </span>
    </div>
  );

  return (
    <div
      className="min-w-0"
      style={{
        marginLeft: depth > 0
          ? `${Math.min(depth, 12) * 16}px`
          : undefined,
      }}
    >
      {active ? (
        <AuroraBorder
          className="w-full"
          tone={
            isDarkTheme
              ? 'dark'
              : 'light'
          }
          motion="perimeter"
          radius={12}
          borderWidth={1}
          duration={4}
        >
          {content}
        </AuroraBorder>
      ) : (
        content
      )}
    </div>
  );
}

function waitReasonKey(
  reason: ActiveWorkflowSnapshot['run']['waitReason'],
): string {
  if (reason === 'USER_INPUT') return 'workflow.wait.input';
  if (reason === 'APPROVAL') return 'workflow.wait.approval';
  if (reason === 'EXTERNAL_DEPENDENCY') return 'workflow.wait.external';
  if (reason === 'RESOURCE_CONFLICT') return 'workflow.wait.resourceConflict';
  return 'workflow.wait.continue';
}

function flattenPhases(
  phases: WorkflowPhaseView[],
): FlattenedPhase[] {
  const byId = new Map(
    phases.map((phase) => [phase.id, phase]),
  );
  const children = new Map<
    string,
    WorkflowPhaseView[]
  >();

  for (const phase of phases) {
    if (!phase.parentPhaseId) continue;
    children.set(
      phase.parentPhaseId,
      [
        ...(children.get(phase.parentPhaseId) ?? []),
        phase,
      ].sort(comparePhase),
    );
  }

  const roots = phases
    .filter(
      (phase) =>
        !phase.parentPhaseId
        || !byId.has(phase.parentPhaseId),
    )
    .sort(comparePhase);

  const result: FlattenedPhase[] = [];
  const visited = new Set<string>();

  const visit = (
    phase: WorkflowPhaseView,
    depth: number,
    ancestors: Set<string>,
  ) => {
    if (visited.has(phase.id)) return;
    visited.add(phase.id);
    result.push({ phase, depth });

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(phase.id);
    for (const child of children.get(phase.id) ?? []) {
      if (nextAncestors.has(child.id)) continue;
      visit(child, depth + 1, nextAncestors);
    }
  };

  for (const root of roots) {
    visit(root, 0, new Set());
  }

  for (const phase of phases) {
    if (!visited.has(phase.id)) {
      visit(phase, 0, new Set());
    }
  }

  return result;
}

function comparePhase(
  left: WorkflowPhaseView,
  right: WorkflowPhaseView,
): number {
  return left.position - right.position
    || left.title.localeCompare(right.title);
}

export default memo(WorkflowLine);
