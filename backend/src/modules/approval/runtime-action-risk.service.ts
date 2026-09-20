import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Tool } from '../../tools/toolstypes';
import type { AgentPermissionMode } from '../seekmore-agent/contracts/agent-turn.types';
import type {
  RuntimeAccessDecision,
  RuntimeRiskLevel,
} from './runtime-access-policy.types';

export interface RuntimeActionRiskAssessment {
  riskLevel: RuntimeRiskLevel;
  requiresApproval: boolean;
  sideEffectClass: string;
  descriptorHash: string;
  reasonCodes: string[];
}

@Injectable()
export class RuntimeActionRiskService {
  async assess(input: {
    tool: Tool;
    arguments: Record<string, unknown>;
    workspaceId: string | null;
  }): Promise<RuntimeActionRiskAssessment> {
    let override: Awaited<ReturnType<NonNullable<Tool['assessRisk']>>> | null = null;
    try {
      override = input.tool.assessRisk
        ? await input.tool.assessRisk(input.arguments, {
            workspaceId: input.workspaceId,
          })
        : null;
    } catch {
      return {
        riskLevel: 'forbidden',
        requiresApproval: true,
        sideEffectClass: input.tool.sideEffectClass ?? 'none',
        descriptorHash: this.hashDescriptor({
          toolName: input.tool.name,
          arguments: input.arguments,
          workspaceId: input.workspaceId,
          riskEvaluator: 'failed',
        }),
        reasonCodes: ['risk:forbidden', 'risk_evaluator:failed'],
      };
    }

    const riskLevel = this.normalizeRiskLevel(override?.riskLevel)
      ?? this.resolveRiskLevel(input.tool);
    const requiresApproval = override?.requiresApproval
      ?? input.tool.requiresApproval === true;
    const reasonCodes = [
      `risk:${riskLevel}`,
      `side_effect:${input.tool.sideEffectClass ?? 'none'}`,
      requiresApproval ? 'approval:tool_declared' : 'approval:not_declared',
      ...(override?.reasonCodes ?? []),
    ];

    return {
      riskLevel,
      requiresApproval,
      sideEffectClass: input.tool.sideEffectClass ?? 'none',
      descriptorHash: this.hashDescriptor({
        toolName: input.tool.name,
        arguments: input.arguments,
        workspaceId: input.workspaceId,
        descriptor: override?.descriptor ?? null,
      }),
      reasonCodes: [...new Set(reasonCodes)],
    };
  }

  decide(input: {
    permissionMode: AgentPermissionMode;
    assessment: RuntimeActionRiskAssessment;
  }): RuntimeAccessDecision {
    if (input.assessment.riskLevel === 'forbidden') return 'BLOCK';

    if (input.permissionMode === 'full_access') return 'ALLOW';

    if (input.permissionMode === 'audit_autorun') {
      return input.assessment.riskLevel === 'high'
        ? 'REQUIRE_APPROVAL'
        : 'ALLOW';
    }

    if (
      input.assessment.requiresApproval
      || input.assessment.riskLevel === 'medium'
      || input.assessment.riskLevel === 'high'
    ) {
      return 'REQUIRE_APPROVAL';
    }

    return 'ALLOW';
  }

  private resolveRiskLevel(tool: Tool): RuntimeRiskLevel {
    const declared = this.normalizeRiskLevel(tool.riskLevel);
    if (declared) return declared;

    if (
      tool.sideEffectClass === 'irreversible_write'
      || tool.sideEffectClass === 'process_execution'
    ) {
      return 'high';
    }

    if (
      tool.sideEffectClass === 'workspace_write'
      || tool.sideEffectClass === 'external_effect'
      || tool.requiresApproval === true
    ) {
      return 'medium';
    }

    return 'low';
  }

  private normalizeRiskLevel(value: unknown): RuntimeRiskLevel | null {
    if (
      value === 'low'
      || value === 'medium'
      || value === 'high'
      || value === 'forbidden'
    ) {
      return value;
    }
    return null;
  }

  private hashDescriptor(value: Record<string, unknown>): string {
    return createHash('sha256')
      .update(this.stableStringify(value))
      .digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (value === undefined) return '"__undefined__"';
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value) ?? 'null';
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`)
      .join(',')}}`;
  }
}
