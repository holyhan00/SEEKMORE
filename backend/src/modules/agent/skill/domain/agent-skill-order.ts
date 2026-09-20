export const AGENT_SKILL_ORDER_MIN = 1;
export const AGENT_SKILL_ORDER_MAX = 1000;

interface AgentSkillOrderRecord {
  skillId: string;
  priority: number;
  enabled: boolean;
  createdAt?: Date | string | null;
}

function createdAtTime(value: Date | string | null | undefined): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function hasCanonicalSequence<T extends AgentSkillOrderRecord>(
  records: T[],
): boolean {
  if (records.length === 0) {
    return true;
  }

  const priorities = records
    .map((record) => record.priority)
    .sort((left, right) => left - right);

  return priorities.every(
    (priority, index) =>
      Number.isInteger(priority) &&
      priority === index + AGENT_SKILL_ORDER_MIN,
  );
}

export function sortAgentSkillOrder<T extends AgentSkillOrderRecord>(
  records: T[],
): T[] {
  return [...records].sort((left, right) => {
    return (
      Number(right.enabled) - Number(left.enabled) ||
      left.priority - right.priority ||
      createdAtTime(left.createdAt) - createdAtTime(right.createdAt) ||
      left.skillId.localeCompare(right.skillId)
    );
  });
}

export function normalizeStoredAgentSkillOrder<
  T extends AgentSkillOrderRecord,
>(records: T[]): T[] {
  if (hasCanonicalSequence(records)) {
    return sortAgentSkillOrder(records);
  }

  const legacyOrder = [...records].sort((left, right) => {
    return (
      Number(right.enabled) - Number(left.enabled) ||
      right.priority - left.priority ||
      createdAtTime(left.createdAt) - createdAtTime(right.createdAt) ||
      left.skillId.localeCompare(right.skillId)
    );
  });

  return legacyOrder.map((record, index) => ({
    ...record,
    priority: index + AGENT_SKILL_ORDER_MIN,
  }));
}

export function normalizeRequestedAgentSkillOrder<
  T extends Pick<AgentSkillOrderRecord, 'skillId' | 'priority'>,
>(records: T[]): T[] {
  return records
    .map((record, index) => ({ record, index }))
    .sort((left, right) => {
      return (
        left.record.priority - right.record.priority ||
        left.index - right.index ||
        left.record.skillId.localeCompare(right.record.skillId)
      );
    })
    .map(({ record }, index) => ({
      ...record,
      priority: index + AGENT_SKILL_ORDER_MIN,
    }));
}
