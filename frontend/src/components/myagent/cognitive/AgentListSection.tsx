                                                       

import type { ReactNode } from 'react';
import { useLocalize } from '../../../localization/useLocalize';

import { resolveAssetUrl } from '../../../utils/asset-url';
import AgentCard from './AgentCard';
import type { CognitiveAgent } from './api/cognitive-agent.types';

interface AgentListSectionProps {

  agents: CognitiveAgent[];
  loading?: boolean;
  error?: string;
  emptyLabel?: string;
  className?: string;
  onAgentClick?: (agent: CognitiveAgent) => void;
  onAgentGoChat?: (agent: CognitiveAgent) => void;
  onAgentAction?: (agent: CognitiveAgent) => void;
  actionLabel?: string;
  actionBusyAgentId?: string | null;
}

function StatePanel({
    children,
}: {

  children: ReactNode;
}) {
  return (
    <div
      className={`flex min-h-[220px] w-full items-center justify-center rounded-[20px] border border-dashed px-8 text-center text-[12px] ${
        'border-[#000000]/[0.09] bg-[#ffffff]/55 text-[#000000]/42 dark:border-[#ffffff]/[0.08] dark:bg-[#ffffff]/[0.02] dark:text-[#ffffff]/38'
      }`}
    >
      {children}
    </div>
  );
}

export default function AgentListSection({
    agents,
  loading,
  error,
  emptyLabel,
  className,
  onAgentClick,
  onAgentGoChat,
  onAgentAction,
  actionLabel,
  actionBusyAgentId,
}: AgentListSectionProps) {
  const localize = useLocalize();
  if (loading) {
    return (
      <StatePanel >
        {localize('agents.loading')}
      </StatePanel>
    );
  }

  if (error) {
    return (
      <StatePanel >
        {error}
      </StatePanel>
    );
  }

  if (!agents.length) {
    return (
      <StatePanel >
        {emptyLabel || localize('agents.empty')}
      </StatePanel>
    );
  }

  return (
    <div
      className={`
        grid
        w-full
        min-w-0
        grid-cols-[repeat(auto-fill,180px)]
        items-start
        justify-start
        gap-[16px]
        ${className || ''}
      `}
    >
      {agents.map((agent) => {
        const action =
          onAgentAction ?? onAgentGoChat;

        return (
          <AgentCard
            key={agent.id}
            name={agent.name}
            description={agent.description}
            agentKey={agent.key}
            isSuper={agent.isSuper}
            type="COGNITIVE"
            avatarUrl={resolveAssetUrl(
              agent.avatarUrl ??
                agent.avatarKey,
              {
                version:
                  agent.avatarUpdatedAt,
              },
            )}
            coverUrl={resolveAssetUrl(
              agent.coverUrl ??
                agent.coverKey,
              {
                version:
                  agent.coverUpdatedAt,
              },
            )}

            onClick={
              onAgentClick
                ? () => onAgentClick(agent)
                : undefined
            }
            onGoChat={
              action
                ? () => action(agent)
                : undefined
            }
            actionLabel={actionLabel}
            actionBusy={
              actionBusyAgentId === agent.id
            }
            actionDisabled={!action}
          />
        );
      })}
    </div>
  );
}