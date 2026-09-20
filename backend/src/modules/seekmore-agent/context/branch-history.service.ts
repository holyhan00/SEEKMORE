import { Injectable } from '@nestjs/common';
import { MessageObjectRole } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { MessageObjectLinkService } from '../../object-runtime/message-object/message-object.service';
import type { AgentAttachedObject, AgentRuntimeMessage } from '../contracts/agent-turn.types';
import { projectAgentObject } from './runtime-object-context';

@Injectable()
export class BranchHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messageObjects: MessageObjectLinkService,
  ) {}

  async load(input: {
    conversationId: string;
    leafMessageId: string;
    userId: string;
    agentId: string;
  }): Promise<{
    messages: AgentRuntimeMessage[];
    branchId: string | null;
    inputObjects: AgentAttachedObject[];
    branchObjectIds: string[];
  }> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId: input.conversationId, deletedAt: null },
      orderBy: { timestamp: 'asc' },
    });

    const byId = new Map(rows.map((row) => [row.id, row]));
    const branch = [] as typeof rows;
    const visited = new Set<string>();
    let cursor = byId.get(input.leafMessageId);

    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      branch.push(cursor);
      cursor = cursor.parentMessageId ? byId.get(cursor.parentMessageId) : undefined;
    }
    branch.reverse();

    let boundaryIndex = -1;
    for (let index = branch.length - 1; index >= 0; index -= 1) {
      if (this.isContextBoundary(branch[index]?.meta)) {
        boundaryIndex = index;
        break;
      }
    }
    const effectiveBranch = boundaryIndex >= 0 ? branch.slice(boundaryIndex) : branch;
    const visibleBranch = effectiveBranch.filter((message) => this.record(message.meta).visibility !== 'internal');
    const visibleMessageIds = visibleBranch.map((message) => message.id);

    const [links, turnInputs] = await Promise.all([
      this.messageObjects.listMessageObjects({
        userId: input.userId,
        conversationId: input.conversationId,
        messageIds: visibleMessageIds,
      }),
      visibleMessageIds.length
        ? this.prisma.agentTurnInput.findMany({
            where: {
              kind: { in: ['STEERING', 'USER_RESPONSE'] },
              turn: {
                userId: input.userId,
                agentId: input.agentId,
                conversationId: input.conversationId,
                userMessageId: { in: visibleMessageIds },
              },
            },
            include: { turn: { select: { userMessageId: true } } },
            orderBy: [{ createdAt: 'asc' }, { sequence: 'asc' }],
          })
        : Promise.resolve([]),
    ]);

    // A link is already partition-checked when it is created. Restrict again to the current agent
    // before projecting branch context so a cross-agent conversation cannot leak an object.
    const safeLinks = links.filter((link) => link.object.agentId === input.agentId);
    const linksByMessage = new Map<string, typeof safeLinks>();
    for (const link of safeLinks) {
      const list = linksByMessage.get(link.messageId) ?? [];
      list.push(link);
      linksByMessage.set(link.messageId, list);
    }

    const supplementObjectIds = [...new Set(turnInputs.flatMap((row) => this.objectRefs(row.objectRefs).map((ref) => ref.objectId)))];
    const supplementObjects = supplementObjectIds.length
      ? await this.prisma.runtimeObject.findMany({
          where: {
            id: { in: supplementObjectIds },
            userId: input.userId,
            agentId: input.agentId,
            conversationId: input.conversationId,
            status: 'available',
            deletedAt: null,
          },
        })
      : [];
    const supplementObjectsById = new Map(supplementObjects.map((object) => [object.id, object]));
    const supplementsByMessage = new Map<string, Array<Record<string, unknown>>>();

    for (const row of turnInputs) {
      const sourceMessageId = row.turn.userMessageId;
      const attachedObjects = this.objectRefs(row.objectRefs).flatMap((ref) => {
        const object = supplementObjectsById.get(ref.objectId);
        return object
          ? [projectAgentObject(object, {
              role: 'user_input',
              messageId: sourceMessageId,
              inputId: row.id,
              inputKind: row.kind === 'USER_RESPONSE' ? 'USER_RESPONSE' : 'STEERING',
              position: ref.position,
            })]
          : [];
      });
      const list = supplementsByMessage.get(sourceMessageId) ?? [];
      list.push({
        inputId: row.id,
        kind: row.kind,
        content: row.content,
        createdAt: row.createdAt.toISOString(),
        ...(attachedObjects.length ? { attachedObjects } : {}),
      });
      supplementsByMessage.set(sourceMessageId, list);
    }

    const inputObjects = (linksByMessage.get(input.leafMessageId) ?? [])
      .filter((link) => link.role === MessageObjectRole.USER_INPUT)
      .sort((left, right) => left.position - right.position)
      .map((link) => projectAgentObject(link.object, {
        role: 'user_input',
        messageId: input.leafMessageId,
        inputKind: 'PRIMARY',
        position: link.position,
      }));

    return {
      messages: visibleBranch.map((message) => {
        if (String(message.role) === 'TOOL') {
          return {
            id: message.id,
            role: 'system' as const,
            content: ['[Historical tool observation]', message.content].filter(Boolean).join('\n'),
            parentMessageId: message.parentMessageId ?? null,
          };
        }

        const role = this.role(String(message.role));
        const messageLinks = (linksByMessage.get(message.id) ?? []).sort((left, right) => left.position - right.position);
        const projectedObjects = messageLinks.map((link) => projectAgentObject(link.object, {
          role: link.role === MessageObjectRole.ASSISTANT_OUTPUT ? 'assistant_output' : 'user_input',
          messageId: message.id,
          inputKind: link.role === MessageObjectRole.USER_INPUT ? 'PRIMARY' : null,
          position: link.position,
        }));
        const supplements = supplementsByMessage.get(message.id) ?? [];
        const content = projectedObjects.length || supplements.length
          ? {
              runtimeContextType: 'message_with_objects',
              text: message.content,
              ...(role === 'user' && projectedObjects.length ? { attachedObjects: projectedObjects } : {}),
              ...(role === 'assistant' && projectedObjects.length ? { producedObjects: projectedObjects } : {}),
              ...(role === 'user' && supplements.length ? { supplements } : {}),
            }
          : message.content;

        return {
          id: message.id,
          role,
          content,
          parentMessageId: message.parentMessageId ?? null,
        };
      }),
      branchId: visibleBranch.at(-1)?.branchId ?? null,
      inputObjects,
      branchObjectIds: [...new Set([
        ...safeLinks.map((link) => link.objectId),
        ...supplementObjects.map((object) => object.id),
      ])],
    };
  }

  private objectRefs(value: unknown): Array<{ objectId: string; position: number }> {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item, index) => {
      const record = this.record(item);
      const objectId = String(record.objectId ?? '').trim();
      if (!objectId) return [];
      const rawPosition = Number(record.position);
      return [{ objectId, position: Number.isInteger(rawPosition) && rawPosition >= 0 ? rawPosition : index }];
    }).sort((left, right) => left.position - right.position);
  }

  private record(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : {};
  }

  private isContextBoundary(value: unknown): boolean {
    const turnContext = this.record(this.record(value).turnContext);
    return turnContext.contextBoundary === true && turnContext.contextBoundaryReason === 'task_reset';
  }

  private role(value: string): AgentRuntimeMessage['role'] {
    const normalized = value.toLowerCase();
    if (normalized === 'assistant' || normalized === 'agent') return 'assistant';
    if (normalized === 'system') return 'system';
    if (normalized === 'tool') return 'tool';
    return 'user';
  }
}
