                                                                            
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { RuntimeObject } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import type { ObjectPartition } from './object.types';

@Injectable()
export class RuntimeObjectAccessPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async assertPartition(partition: ObjectPartition): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: partition.conversationId,
        userId: partition.userId,
        agentId: partition.agentId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!conversation) this.deny();
  }

  canRead(object: RuntimeObject, partition: ObjectPartition): boolean {
    return object.userId === partition.userId
      && object.agentId === partition.agentId
      && object.conversationId === partition.conversationId
      && object.status === 'available'
      && object.deletedAt === null;
  }

  assertRead(object: RuntimeObject | null, partition: ObjectPartition): asserts object is RuntimeObject {
    if (!object || !this.canRead(object, partition)) this.deny();
  }

  private deny(): never {
    throw new ForbiddenException('OBJECT_PARTITION_NOT_ACCESSIBLE');
  }
}
