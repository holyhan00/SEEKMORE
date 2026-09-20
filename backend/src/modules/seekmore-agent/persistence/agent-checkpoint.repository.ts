import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';

@Injectable()
export class AgentCheckpointRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: {
    turnId: string;
    state: Record<string, unknown>;
    pendingToolCallId?: string | null;
    pendingApprovalId?: string | null;
  }) {
    return this.prisma.agentTurnCheckpoint.create({
      data: {
        turnId: input.turnId,
        stateJson: input.state as Prisma.InputJsonValue,
        pendingToolCallId: input.pendingToolCallId ?? null,
        pendingApprovalId: input.pendingApprovalId ?? null,
      },
    });
  }

  latest(turnId: string) {
    return this.prisma.agentTurnCheckpoint.findFirst({
      where: { turnId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
