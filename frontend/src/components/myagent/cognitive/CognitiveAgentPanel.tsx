import { resolveAssetUrl } from '../../../utils/asset-url';
                                                                    

import { useAppearance } from '../../../theme/useAppearance';
import { useMemo, useState } from 'react';

import { useLocalize } from '../../../localization/useLocalize';
import ConfirmModal from '../../../common/modals/ConfirmModal';
import AgentListSection from './AgentListSection';
import AgentDetailView from './AgentDetailView';
import {
  permanentlyDeleteCognitiveAgent,
  restoreCognitiveAgent,
} from './api/cognitive-agent.api';
import type {
  CognitiveAgent,
  CognitiveAgentLibraryView,
} from './api/cognitive-agent.types';
import { useCognitiveAgentCreateFlow } from './hooks/useCognitiveAgentCreateFlow';
import { useCognitiveAgents } from './hooks/useCognitiveAgents';
import CognitiveAgentCreateModal from './modals/CognitiveAgentCreateModal';
import CognitiveAgentRecycleCard from './recycle/CognitiveAgentRecycleCard';

interface CognitiveAgentPanelProps {

}

const COGNITIVE_AGENT_VIEWS: Array<{
  value: CognitiveAgentLibraryView;
  labelKey: string;
}> = [
  { value: 'active', labelKey: 'agents.library.mine' },
  { value: 'deleted', labelKey: 'common.status.deleted' },
];

export default function CognitiveAgentPanel({
}: CognitiveAgentPanelProps) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();
  const createFlow =
    useCognitiveAgentCreateFlow();

  const [view, setView] =
    useState<CognitiveAgentLibraryView>('active');

  const [selectedAgent, setSelectedAgent] =
    useState<CognitiveAgent | null>(null);

  const [
    restoringAgentId,
    setRestoringAgentId,
  ] = useState<string | null>(null);

  const [purgingAgentId, setPurgingAgentId] =
    useState<string | null>(null);

  const [purgeTarget, setPurgeTarget] =
    useState<CognitiveAgent | null>(null);

  const {
    agents,
    loading,
    refresh,
  } = useCognitiveAgents(true, view);

  const deletedView =
    view === 'deleted';

  const sortedAgents = useMemo(
    () =>
      [...agents].sort((left, right) => {
        if (!deletedView) {
          const defaultOrder =
            Number(
              Boolean(right.isDefaultAgent),
            ) -
            Number(
              Boolean(left.isDefaultAgent),
            );

          if (defaultOrder !== 0) {
            return defaultOrder;
          }
        }

        const leftTime = new Date(
          deletedView
            ? left.deletedAt ||
                left.updatedAt ||
                left.createdAt
            : left.updatedAt ||
                left.createdAt,
        ).getTime();

        const rightTime = new Date(
          deletedView
            ? right.deletedAt ||
                right.updatedAt ||
                right.createdAt
            : right.updatedAt ||
                right.createdAt,
        ).getTime();

        return rightTime - leftTime;
      }),
    [agents, deletedView],
  );

  const switchView = (
    nextView: CognitiveAgentLibraryView,
  ) => {
    if (nextView === view) {
      return;
    }

    setView(nextView);
    setSelectedAgent(null);
  };

  const goToChat = (
    agent: CognitiveAgent,
  ) => {
    sessionStorage.setItem(
      'pending-open-agent-id',
      agent.id,
    );

    sessionStorage.setItem(
      'pending-open-agent',
      JSON.stringify(agent),
    );

    window.dispatchEvent(
      new CustomEvent('agentChat:open', {
        detail: {
          agentId: agent.id,
          agent,
        },
      }),
    );

    window.dispatchEvent(
      new CustomEvent('changeView', {
        detail: 'chat',
      }),
    );
  };

  const restoreAgent = async (
    agent: CognitiveAgent,
  ) => {
    if (
      restoringAgentId ||
      purgingAgentId
    ) {
      return;
    }

    setRestoringAgentId(agent.id);

    try {
      const restored =
        await restoreCognitiveAgent(
          agent.id,
        );

      window.dispatchEvent(
        new CustomEvent(
          'agent:restored',
          {
            detail: {
              agentId: restored.id,
              agent: restored,
            },
          },
        ),
      );

      await refresh();
    } catch (reason) {
      console.error(
        '[CognitiveAgent] Restore failed',
        reason,
      );
    } finally {
      setRestoringAgentId(null);
    }
  };

  const purgeAgent = async () => {
    if (
      !purgeTarget ||
      restoringAgentId ||
      purgingAgentId
    ) {
      return;
    }

    setPurgingAgentId(
      purgeTarget.id,
    );

    try {
      await permanentlyDeleteCognitiveAgent(
        purgeTarget.id,
      );

      window.dispatchEvent(
        new CustomEvent(
          'agent:permanently-deleted',
          {
            detail: {
              agentId:
                purgeTarget.id,
            },
          },
        ),
      );

      setPurgeTarget(null);
      await refresh();
    } catch (reason) {
      console.error(
        '[CognitiveAgent] Permanent delete failed',
        reason,
      );
    } finally {
      setPurgingAgentId(null);
    }
  };

  if (
    selectedAgent &&
    !deletedView
  ) {
    return (
      <AgentDetailView
        agent={selectedAgent}
        onBack={() =>
          setSelectedAgent(null)
        }
        onChanged={refresh}
      />
    );
  }

  return (
    <main
      className={`h-full overflow-y-auto pb-8 [&_button]:!select-none [&_button_*]:!select-none ${
        'bg-surface-page '
      }`}
    >
      <div className="mx-auto w-[95%] min-w-0">
        <header
          className="relative flex min-h-[132px] items-end justify-between overflow-hidden rounded-[18px] bg-cover bg-center bg-no-repeat px-[22px]"
          style={{
            backgroundImage: `url("${
              isDarkTheme
                ? resolveAssetUrl('/backgrounds/agent-card-dark.jpg')
                : resolveAssetUrl('/backgrounds/agent-card-light.jpg')
            }")`,
          }}
          onCopy={(event) =>
            event.preventDefault()
          }
        >
          <div
            className={`pointer-events-none absolute inset-0 ${
              'bg-surface-inverse-soft '
            }`}
          />

          <div className="relative bottom-[16px] z-10 flex min-w-0 select-none flex-col gap-0">
            <h1
              className={`m-0 select-none text-[27px] font-semibold leading-[50px] tracking-[-0.035em] ${
                'text-theme-title '
              }`}
            >
              {localize('agents.title')}
            </h1>

            <p
              className={`m-0 select-none text-[12px] leading-[10px] ${
                'text-theme-subtle '
              }`}
            >
              {deletedView
                ? localize(
                    'agents.library.deletedDescription',
                  )
                : localize(
                    'agents.library.description',
                  )}
            </p>
          </div>

          {!deletedView && (
            <button
              type="button"
              onClick={
                createFlow.openCognitiveCreate
              }
              className="relative bottom-[16px] z-10 flex h-10 shrink-0 select-none items-center justify-center rounded-[11px] bg-action-primary px-5 py-0 text-[12px] font-medium !text-[#ffffff] shadow-[0_10px_24px_rgba(12,92,251,0.2)] transition hover:bg-action-primary-hover hover:!text-[#ffffff] active:translate-y-px"
            >
              {localize(
                'agents.actions.create',
              )}
            </button>
          )}
        </header>

        <div className="mt-[10px] flex min-w-0 gap-[10px]">
          {COGNITIVE_AGENT_VIEWS.map(
            (item) => {
              const active =
                item.value === view;

              return (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    switchView(
                      item.value,
                    )
                  }
                  className={`box-border h-[40px] min-w-[78px] shrink-0 select-none rounded-[11px] border px-[12px] text-[10px] font-medium outline-none transition-all ${
                    active
                      ? 'border-[#0c5cfb] bg-action-primary text-[#ffffff] shadow-[0_7px_18px_rgba(12,92,251,0.18)]'
                      : 'border-edge-alpha-07 bg-surface-control-alt text-[#5b616b] hover:border-[#000000]/[0.12] hover:text-[#171717]   dark:text-[#ffffff]/55 dark:hover:border-[#ffffff]/[0.12] dark:hover:text-[#ffffff]'
                  }`}
                >
                  {localize(
                    item.labelKey,
                  )}
                </button>
              );
            },
          )}
        </div>

        <div
          className={`mt-[12px] select-none text-[10px] ${
            'text-theme-dim '
          }`}
        >
          {localize(
            'agents.library.count',
            {
              count:
                sortedAgents.length,
            },
          )}
        </div>

        {!deletedView ? (
          !loading &&
          sortedAgents.length > 0 ? (
            <AgentListSection
              className="mt-[24px]"
              agents={sortedAgents}
              loading={false}
              error=""
              emptyLabel=""
              onAgentClick={
                setSelectedAgent
              }
              onAgentGoChat={
                goToChat
              }
            />
          ) : null
        ) : !loading &&
          sortedAgents.length > 0 ? (
          <div
            className="
              mt-[24px]
              grid
              w-full
              min-w-[392px]
              items-start
              justify-items-center
              gap-[16px]
            "
            style={{
              gridTemplateColumns:
                'repeat(3, minmax(120px, 1fr))',
            }}
          >
            {sortedAgents.map(
              (agent) => (
                <CognitiveAgentRecycleCard
                  key={agent.id}
                  agent={agent}
                  restoring={
                    restoringAgentId ===
                    agent.id
                  }
                  purging={
                    purgingAgentId ===
                    agent.id
                  }
                  onRestore={() =>
                    void restoreAgent(
                      agent,
                    )
                  }
                  onPurge={() =>
                    setPurgeTarget(
                      agent,
                    )
                  }
                />
              ),
            )}
          </div>
        ) : null}
      </div>

      <CognitiveAgentCreateModal
        open={
          createFlow.createCognitiveOpen
        }
        onClose={
          createFlow.closeCognitiveCreate
        }
        onCreated={refresh}
      />

      <ConfirmModal
        isOpen={Boolean(purgeTarget)}
        title={localize(
          'agents.purge.confirmTitle',
        )}
        description={
          purgeTarget
            ? localize(
                'agents.purge.confirmDescription',
                {
                  name:
                    purgeTarget.name,
                  conversationCount:
                    purgeTarget.conversationCount ??
                    0,
                  messageCount:
                    purgeTarget.messageCount ??
                    0,
                },
              )
            : ''
        }
        confirmText={
          purgingAgentId
            ? localize(
                'common.actions.deleting',
              )
            : localize(
                'agents.actions.purge',
              )
        }
        cancelText={localize(
          'common.actions.cancel',
        )}
        danger
        onClose={() => {
          if (!purgingAgentId) {
            setPurgeTarget(null);
          }
        }}
        onConfirm={() => {
          if (!purgingAgentId) {
            void purgeAgent();
          }
        }}
      />
    </main>
  );
}