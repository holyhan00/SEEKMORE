                                                             
import { Injectable, Logger } from '@nestjs/common';
import { LLMClientService } from '../../llm/llm-client.service';
import { MemoryCandidateNormalizer } from './memory-candidate-normalizer.service';
import type { MemoryCandidate } from '../kernel/memory.types';
import type { MemoryWriteFrame } from '../frames/memory-frame.types';

@Injectable()
export class LlmMemoryExtractor {
  private readonly logger = new Logger(LlmMemoryExtractor.name);

  constructor(
    private readonly llm: LLMClientService,
    private readonly normalizer: MemoryCandidateNormalizer,
  ) {}

  async extract(frame: MemoryWriteFrame): Promise<MemoryCandidate[]> {
    if (frame.intent === 'none') return [];

    const userText = String(frame.userText ?? '').trim();
    if (!userText) return [];

    const assistantContext = String(frame.assistantText ?? '').trim();
    const userId = String(frame.operationActor?.userId ?? '').trim();
    if (!userId) return [];

    const prompt = [
      'Extract durable memory candidates from the current user message. Return strict JSON only.',
      'Only extract information explicitly grounded in the user message.',
      'Do not extract memories from assistant advice, explanations, guesses, examples, or generic recommendations.',
      'Do not infer hidden private or sensitive attributes.',
      'If the user directly states private, sensitive, health, legal, financial, family, relationship, or personal-risk information, extract it with the correct sensitivity instead of dropping it.',
      'Do not create a memory when the information is hypothetical, ambiguous, low confidence, or only useful inside the current reply.',
      'For implicit turns, extract at most one high-value durable candidate.',
      'Repeated, reinforced, or restated durable user facts must still be extracted. Downstream governance decides whether to keep pending, promote, update, skip, or merge.',
      'A repeated fact includes the user restating an ongoing personal state, relationship context, preference, constraint, workflow, project state, or tool habit in different wording.',
      'Return an empty candidates array only when the user message contains no durable user-specific fact.',
      'Use this JSON shape:',
      '{"candidates":[{"kind":"identity|preference|constraint|project_state|goal|relationship|workflow|tool_preference|event|episode","subject":"short subject","predicate":"relation/action","value":{},"summary":"short reusable memory","scopeLevel":"user|agent|conversation|project|org|group|plan","stability":"long_term|session|ephemeral","sensitivity":"normal|private|sensitive|restricted","confidence":0.0,"quote":"minimal supporting quote from user message","tags":[]}] }',
      'Classification rules:',
      '- preference/tool_preference/constraint: user-stated durable preferences, requirements, workflows, or tool/code habits. Use normal sensitivity unless the content itself is private or sensitive.',
      '- project_state/goal/workflow: durable project or work state that can help future assistance. Use normal/private/sensitive according to content.',
      '- relationship: durable interpersonal, family, or social relationship context. Use private unless it includes highly sensitive details.',
      '- Health, mental health, legal issues, finances, family conflict, relationship conflict, and similarly personal matters should be marked private or sensitive so governance can require confirmation.',
      '- If the user asks whether you remember something, describes what the assistant said, or discusses memory behavior without stating a new durable fact, return no candidates.',
      '- If the user asks to delete, forget, restore, or inspect memory, do not create a new preference candidate about that command.',
      `Frame intent: ${frame.intent}`,
      `Explicitness: ${frame.explicitness}`,
      `Conversation: ${frame.source.conversationId ?? '-'}`,
      '',
      'Current user message:',
      userText.slice(0, 5000),
      '',
      'Assistant message is context only. Do not extract from it:',
      assistantContext.slice(0, 1200),
    ].join('\n');

    try {
      const raw = await this.llm.chat({
        userId,
        content: prompt,
        agentId: undefined,
        modelId: process.env.MEMORY_EXTRACT_MODEL_ID || undefined,
        systemPrompt: 'You are a memory extraction engine. Return JSON only. No markdown.',
      } as any);

      const parsed = this.parseJson(raw);
      const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];

      return this.normalizer.normalizeMany(
        candidates.map((candidate: any) => ({
          ...candidate,
          evidence: {
            source: frame.explicitness === 'explicit' ? 'explicit_user_statement' : 'conversation_turn',
            conversationId: frame.source.conversationId ?? null,
            userMessageId: frame.source.userMessageId ?? null,
            assistantMessageId: frame.source.assistantMessageId ?? null,
            traceId: frame.source.traceId ?? null,
            quote: candidate.quote ?? null,
          },
        })),
      );
    } catch (error: any) {
      this.logger.warn(`[MemoryExtract] failed: ${error?.message ?? String(error)}`);
      return [];
    }
  }

  private parseJson(raw: string): any {
    const text = String(raw ?? '').trim();
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
    const body = fenced ?? text;
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end < start) return null;
    return JSON.parse(body.slice(start, end + 1));
  }
}
