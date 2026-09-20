import { useRecoilValue } from 'recoil';
import { chatConversationTurnState } from '../store/chatState';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeChatObject } from '../Chat.utils';
import { useContentParsing } from './useContentParsing';

import BubbleUser from './parts/BubbleUser';
import BubbleAgent from './parts/BubbleAgent';
import ToolbarUser from './parts/ToolbarUser';
import ToolbarAgent from './parts/ToolbarAgent';
import MessageObjectCards from '../object-card/MessageObjectCards';
import AutomationMessageCards from '../automation/AutomationMessageCards';

import type { ChatMessageDTO } from './types';
import type { RuntimeDisplayProjection } from '../runtime/display/runtime-display.types';
import type { RuntimeApprovalDecision } from '../runtime/approval/runtimeApprovalClient';
import type { ChatObjectCard } from '../../../utils/types';

import { copyText } from '../../../runtime/clipboard/clipboard.service';

import BranchSnapshotBoundary from './BranchSnapshotBoundary';

type CopyState = 'idle' | 'copied' | 'error';

interface ChatMessageProps {
  messageId?: string;
  msg: ChatMessageDTO;


  loading?: boolean;

  turnActive?: boolean;

  currentUserId?: string | null;

  runtimeDisplay?: RuntimeDisplayProjection | null;

  onApprovalDecision?: (
    approvalId: string,
    decision: RuntimeApprovalDecision,
    taskRunId?: string,
  ) => void;

  onBranchFromMessage?: (
    messageId: string,
  ) => void;

  branching?: boolean;
}

const ChatMessage: React.FC<ChatMessageProps> = ({
  messageId,
  msg,

  loading = false,

  turnActive = false,

  currentUserId,

  runtimeDisplay = null,

  onApprovalDecision,

  onBranchFromMessage,

  branching = false,
}) => {

  const turnInputs = useRecoilValue(chatConversationTurnState(msg.conversationId ?? '__no_conv__')).inputs;
  const supplements = turnInputs.filter((row) =>
    (row.userMessageId ?? row.turn?.userMessageId) === (messageId ?? msg.id)
    && ['STEERING', 'USER_RESPONSE'].includes(row.kind)).sort((a, b) => a.sequence - b.sequence);
  const isMe = useMemo(() => {

    if (msg.isMe === true) {
      return true;
    }

    const current =
      (currentUserId ?? '').trim();

    const sender =
      (msg.senderUserId ?? '').trim();

    return Boolean(
      current &&
      sender &&
      current === sender,
    );

  }, [
    currentUserId,
    msg.isMe,
    msg.senderUserId,
  ]);

  const role: 'user' | 'agent' | 'system' =
    useMemo(() => {

      const value =
        String(msg.role ?? '').toLowerCase();

      if (value === 'user') {
        return 'user';
      }

      if (value === 'system') {
        return 'system';
      }

      return 'agent';

    }, [
      msg.role,
    ]);

  const {
    pureText,
  } = useContentParsing(msg.content);

  const displayObjects = useMemo(() => {

    const expectedRole =
      role === 'user'
        ? 'user_input'
        : role === 'agent'
          ? 'assistant_output'
          : null;

    if (!expectedRole) {
      return [];
    }

    return (
      Array.isArray(msg.objects)
        ? msg.objects
        : []
    )
      .map(normalizeChatObject)
      .filter(
        (
          object,
        ): object is ChatObjectCard =>
          Boolean(
            object &&
            object.role === expectedRole,
          ),
      )
      .sort(
        (
          left,
          right,
        ) =>
          left.position -
          right.position,
      );

  }, [
    msg.objects,
    role,
  ]);

  const assistantImageObjects = useMemo(
    () => role === 'agent'
      ? displayObjects.filter(
          (object) => object.objectKind === 'image',
        )
      : [],
    [displayObjects, role],
  );

  const assistantOtherObjects = useMemo(
    () => role === 'agent'
      ? displayObjects.filter(
          (object) => object.objectKind !== 'image',
        )
      : [],
    [displayObjects, role],
  );

  const [
    copyState,
    setCopyState,
  ] = useState<CopyState>('idle');

  const copyResetTimerRef =
    useRef<number | null>(null);

  useEffect(() => {

    return () => {

      if (
        copyResetTimerRef.current !== null
      ) {
        window.clearTimeout(
          copyResetTimerRef.current,
        );
      }

    };

  }, []);

  const scheduleCopyStateReset =
    () => {

      if (
        copyResetTimerRef.current !== null
      ) {
        window.clearTimeout(
          copyResetTimerRef.current,
        );
      }

      copyResetTimerRef.current =
        window.setTimeout(() => {

          copyResetTimerRef.current =
            null;

          setCopyState('idle');

        }, 1800);

    };

  const handleCopy =
    async () => {

      const textToCopy =
        [pureText, ...supplements.map((row) => row.content)].filter(Boolean).join('\n\n').trim();

      if (!textToCopy) {

        setCopyState('error');

        scheduleCopyStateReset();

        return;

      }

      const result =
        await copyText(
          textToCopy,
        );

      setCopyState(
        result.ok
          ? 'copied'
          : 'error',
      );

      scheduleCopyStateReset();

    };

  const branchMessageId =
    String(
      msg.id ||
      messageId ||
      '',
    ).trim();

  const canBranch =
    role === 'agent'
    &&
    Boolean(
      onBranchFromMessage &&
      branchMessageId,
    )
    &&
    msg.branchable === true
    &&
    !loading;

  const handleBranch =
    canBranch
      ? () =>
          onBranchFromMessage?.(
            branchMessageId,
          )
      : undefined;

  const containerClass =
    useMemo(
      () =>
        `w-full flex ${
          isMe
            ? 'justify-end'
            : 'justify-start'
        } ${
          'text-theme-input '
        }`,
      [
        isMe,
      ],
    );

  const createdAtMs =
    useMemo(() => {

      const value =
        msg.createdAt;

      if (!value) {
        return null;
      }

      const parsed =
        typeof value === 'number'
          ? value
          : Date.parse(
              String(value),
            );

      return Number.isFinite(parsed)
        ? parsed
        : null;

    }, [
      msg.createdAt,
    ]);

  const consideredStuck =
    !isMe
    &&
    role !== 'system'
    &&
    Boolean(loading)
    &&
    createdAtMs !== null
    &&
    Date.now() - createdAtMs > 15000;

  const isCompleteFlag =
    (msg as any)?.is_complete === true
    ||
    (msg as any)?.isComplete === true;

  const showAgentToolbar =
    !isMe
    &&
    role !== 'system'
    &&
    (
      !loading
      ||
      isCompleteFlag
    );

  return (
    <>

      <div
        id={messageId}
        className={containerClass}
      >

        <div
          className={
            `${
              isMe
                ? 'flex flex-col items-end'
                : 'flex flex-col items-start'
            } w-full`
          }
        >

          {isMe ? (

            <>

              {
                displayObjects.length > 0 &&
                (
                  <MessageObjectCards
                    objects={displayObjects}

                    displayRole="user"
                    className="mb-[12px]"
                  />
                )
              }

              <BubbleUser

                text={pureText}
              />

              {supplements.map((segment) => (
                <div key={segment.id} className="mt-3 flex flex-col items-end">
                  {!!segment.objects?.length && <MessageObjectCards objects={segment.objects.map(normalizeChatObject).filter(Boolean) as ChatObjectCard[]} displayRole="user" className="mb-[12px]" />}
                  {segment.content.trim() && <BubbleUser text={segment.content} />}
                </div>
              ))}
              <ToolbarUser

                onCopyClick={() =>
                  void handleCopy()
                }
                copyState={copyState}
              />

            </>

          ) : (

            <>

              <div className="mb-[15px] w-full bg-transparent">

                <BubbleAgent



                  pureText={pureText}

                  loading={
                    Boolean(loading)
                    &&
                    !consideredStuck
                  }

                  citations={
                    msg.citations ?? null
                  }

                  turnActive={
                    turnActive
                  }

                  runtimeDisplay={
                    runtimeDisplay
                  }

                  imageObjects={
                    assistantImageObjects
                  }

                  outputObjects={
                    displayObjects
                  }

                  onApprovalDecision={
                    onApprovalDecision
                  }

                />

              </div>

              {
                assistantOtherObjects.length > 0 &&
                (
                  <MessageObjectCards
                    objects={assistantOtherObjects}

                    displayRole="assistant"
                    className="mb-[12px]"
                  />
                )
              }

              {
                msg.conversationId && branchMessageId &&
                (
                  <AutomationMessageCards
                    conversationId={msg.conversationId}
                    anchorMessageId={branchMessageId}

                  />
                )
              }

              {
                showAgentToolbar &&
                (
                  <ToolbarAgent



                    onCopyClick={() =>
                      void handleCopy()
                    }

                    copyState={copyState}

                    onBranchClick={
                      handleBranch
                    }

                    branching={
                      branching
                    }

                  />
                )
              }

            </>

          )}

        </div>

      </div>

      {
        role === 'agent'
        &&
        msg.branchSnapshotBoundary === true
        &&
        (
          <BranchSnapshotBoundary />
        )
      }

    </>
  );
};

export default ChatMessage;
