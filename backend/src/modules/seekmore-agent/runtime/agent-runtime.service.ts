// backend/src/modules/seekmore-agent/runtime/agent-runtime.service.ts

import { Injectable } from '@nestjs/common';

import type {
  AgentRuntimeTurnRequest,
} from '../contracts/agent-turn.types';

import type {
  AgentRuntimeEvent,
} from '../contracts/agent-runtime-event.types';

import type {
  AgentRuntimeHooks,
  AgentRuntimeRunResult,
} from './agent-runtime.types';

import {
  AgentLoopService,
} from './loop/agent-loop.service';


@Injectable()
export class AgentRuntimeService {
  constructor(
    private readonly loop: AgentLoopService,
  ) {}

  async run(
    request: AgentRuntimeTurnRequest,
    hooks: AgentRuntimeHooks,
  ): Promise<AgentRuntimeRunResult> {
    /*
     * Runtime 只启动一次 AgentLoop。
     *
     * Focus 是 AgentLoop 内部的认知聚焦与按需主动学习策略，
     * 不再通过独立模型调用、结构化 decision、parser 或 gate
     * 预判当前 Turn 是否允许继续。
     *
     * 这样可以保证：
     * - 不增加 Focus 专用模型调用；
     * - 不重复 AgentLoop 自身的意图理解与推理；
     * - Focus 判断失败不会成为 Turn 的系统级失败点；
     * - AgentLoop 始终拥有当前 Request 的完整工具池与执行权。
     */
    const result =
      await this.loop.run(
        request,
        hooks,
      );

    const common = {
      traceId:
        request.traceId,

      conversationId:
        request.conversationId,

      userMessageId:
        request.userMessageId,

      assistantMessageId:
        request.assistantMessageId,

      timestamp:
        Date.now(),

      content:
        result.content,

      detail: {
        outcome:
          result.outcome,

        iterations:
          result.iterations,

        toolCallCount:
          result.toolCallCount,

        usage:
          result.usage,

        timing:
          result.metadata.timing,
      },
    };

    const event:
      AgentRuntimeEvent =
      result.outcome.kind === 'paused'
        ? {
            ...common,
            type: 'turn.paused',
            reason:
              result.outcome.reason,
          }
        : {
            ...common,
            type: 'turn.completed',
          };

    await hooks.onEvent?.(
      event,
    );

    return result;
  }
}
