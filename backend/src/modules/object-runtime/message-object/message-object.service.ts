import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MessageObjectRole, MessageRole, type Prisma } from '@prisma/client';
import { RuntimeFlowTraceLogger } from '../../../common/trace/runtime-flow-trace.logger';
import { RuntimeObjectCapabilityPolicyService } from '../object-processing/runtime-object-capability-policy.service';
import { MessageObjectLinkRepository } from './message-object.repository';
import type {
  AssistantOutputObjectInput,
  ChatObjectRefInput,
  MessageObjectLinkWithObject,
  MessageObjectPartition,
} from './message-object.types';

type DbClient = Prisma.TransactionClient;

@Injectable()
export class MessageObjectLinkService {
  constructor(
    private readonly repository: MessageObjectLinkRepository,
    private readonly trace: RuntimeFlowTraceLogger,
    private readonly capabilityPolicy: RuntimeObjectCapabilityPolicyService,
  ) {}

  async bindUserInputs(
    tx: DbClient,
    input: MessageObjectPartition & {
      messageId: string;
      objectRefs: ChatObjectRefInput[];
    },
  ): Promise<void> {
    const refs = this.normalizeRefs(input.objectRefs);
    await this.assertMessage(tx, {
      messageId: input.messageId,
      conversationId: input.conversationId,
      expectedRole: MessageRole.USER,
    });
    await this.assertObjects(tx, input, refs.map((ref) => ref.objectId), true);
    await this.repository.createLinks(tx, {
      messageId: input.messageId,
      role: MessageObjectRole.USER_INPUT,
      refs,
    });
    this.trace.event('message_object.user_inputs_bound', {
      conversationId: input.conversationId,
      messageId: input.messageId,
      objectCount: refs.length,
    });
  }

  async bindAssistantOutputs(
    tx: DbClient,
    input: MessageObjectPartition & {
      messageId: string;
      objects: AssistantOutputObjectInput[];
    },
  ): Promise<void> {
    const refs = this.normalizeRefs(input.objects);
    await this.assertMessage(tx, {
      messageId: input.messageId,
      conversationId: input.conversationId,
      expectedRole: MessageRole.ASSISTANT,
    });
    await this.assertObjects(tx, input, refs.map((ref) => ref.objectId), false);
    await this.repository.createLinks(tx, {
      messageId: input.messageId,
      role: MessageObjectRole.ASSISTANT_OUTPUT,
      refs,
    });
    this.trace.event('message_object.assistant_outputs_bound', {
      conversationId: input.conversationId,
      messageId: input.messageId,
      objectCount: refs.length,
    });
  }

  listMessageObjects(input: {
    messageIds: string[];
    userId: string;
    conversationId: string;
  }): Promise<MessageObjectLinkWithObject[]> {
    return this.repository.listByMessageIds(input);
  }

  listCurrentUserInputs(
    input: MessageObjectPartition & { messageId: string },
  ): Promise<MessageObjectLinkWithObject[]> {
    return this.repository.listByMessageAndRole({
      messageId: input.messageId,
      role: MessageObjectRole.USER_INPUT,
      partition: input,
    });
  }

  listAssistantOutputs(
    input: MessageObjectPartition & { messageId: string },
  ): Promise<MessageObjectLinkWithObject[]> {
    return this.repository.listByMessageAndRole({
      messageId: input.messageId,
      role: MessageObjectRole.ASSISTANT_OUTPUT,
      partition: input,
    });
  }

  private normalizeRefs(
    values: Array<{ objectId: string; position?: number }> | null | undefined,
  ): Array<{ objectId: string; position: number }> {
    const refs: Array<{ objectId: string; position: number }> = [];
    const objectIds = new Set<string>();
    const positions = new Set<number>();

    for (const [index, value] of (values ?? []).entries()) {
      const objectId = String(value?.objectId ?? '').trim();
      if (!objectId) throw new BadRequestException({ code: 'OBJECT_ID_REQUIRED', message: 'OBJECT_ID_REQUIRED' });
      const position = Number.isInteger(value?.position) && Number(value.position) >= 0
        ? Number(value.position)
        : index;
      if (objectIds.has(objectId)) throw new BadRequestException({ code: 'OBJECT_ID_DUPLICATE', message: 'OBJECT_ID_DUPLICATE', params: { objectId } });
      if (positions.has(position)) throw new BadRequestException({ code: 'OBJECT_POSITION_DUPLICATE', message: 'OBJECT_POSITION_DUPLICATE', params: { position } });
      objectIds.add(objectId);
      positions.add(position);
      refs.push({ objectId, position });
    }

    return refs.sort((left, right) => left.position - right.position);
  }

  private async assertMessage(
    tx: DbClient,
    input: { messageId: string; conversationId: string; expectedRole: MessageRole },
  ): Promise<void> {
    const message = await tx.message.findUnique({
      where: { id: input.messageId },
      select: { id: true, conversationId: true, role: true, deletedAt: true },
    });
    if (!message || message.deletedAt) throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'MESSAGE_NOT_FOUND' });
    if (message.conversationId !== input.conversationId) {
      throw new ForbiddenException({ code: 'MESSAGE_CONVERSATION_MISMATCH', message: 'MESSAGE_CONVERSATION_MISMATCH' });
    }
    if (message.role !== input.expectedRole) {
      throw new BadRequestException({ code: 'MESSAGE_OBJECT_ROLE_MISMATCH', message: 'MESSAGE_OBJECT_ROLE_MISMATCH' });
    }
  }

  private async assertObjects(
    tx: DbClient,
    partition: MessageObjectPartition,
    objectIds: string[],
    requireAgentReady: boolean,
  ): Promise<void> {
    if (objectIds.length === 0) return;
    const objects = await this.repository.findAvailableObjects(tx, partition, objectIds);
    const available = new Set(
      objects
        .filter((object) => !requireAgentReady || this.capabilityPolicy.isReadyForMessageInput(object))
        .map((object) => object.id),
    );
    const missing = objectIds.filter((objectId) => !available.has(objectId));
    if (missing.length > 0) {
      throw new ForbiddenException(
        requireAgentReady
          ? `Object parsing is incomplete or inaccessible: ${missing.join(', ')}`
          : `Object does not exist or is inaccessible: ${missing.join(', ')}`,
      );
    }
  }

}
