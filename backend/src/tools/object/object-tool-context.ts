import type { ToolContext } from '../toolstypes';
import { ToolError } from '../toolstypes';

export function objectToolPartition(ctx: ToolContext): {
  userId: string;
  agentId: string;
  conversationId: string;
} {
  const userId = String(ctx.userId ?? '').trim();
  const conversationId = String(ctx.conversationId ?? '').trim();
  const agentId = String(ctx.metadata?.agentId ?? '').trim();

  if (!userId) throw new ToolError('OBJECT_USER_CONTEXT_REQUIRED', 'Object tools require a user context');
  if (!agentId) throw new ToolError('OBJECT_AGENT_CONTEXT_REQUIRED', 'Object tools require an agent context');
  if (!conversationId) throw new ToolError('OBJECT_CONVERSATION_CONTEXT_REQUIRED', 'Object tools require a conversation context');

  return { userId, agentId, conversationId };
}
