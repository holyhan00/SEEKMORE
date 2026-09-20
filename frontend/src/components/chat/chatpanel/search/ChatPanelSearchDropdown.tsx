import { resolveAssetUrl } from '../../../../utils/asset-url';
                                                                     
import React, { useEffect, useRef } from 'react';
import { useLocalize } from '../../../../localization/useLocalize';
import ChatPanelSearchDropdownItem from './ChatPanelSearchDropdownItem';

export type AgentHit = {
  id: string;
  name: string;
  remark?: string;
  avatarUrl?: string;
  lastMessage?: string;
  isSuper?: boolean;
};

export type ConvHit = {
  id: string;
  agentId: string;
  title: string;
  snippet?: string;
  avatarUrl?: string;
};

interface Props {
  visible: boolean;
  anchorRef: React.RefObject<HTMLDivElement | null>;

  query: string;
  agents: AgentHit[];
  conversations: ConvHit[];
  onPickAgent: (agentId: string) => void;
  onPickConversation: (cid: string, agentId: string) => void;
  onWebSearch: (keyword: string) => void;
  onClose: () => void;

                                  
  conversationsLabel?: string;
}

const ChatPanelSearchDropdown: React.FC<Props> = ({
  visible,
  anchorRef,
    query,
  agents,
  conversations,
  onPickAgent,
  onPickConversation,
  onWebSearch,
  onClose,
  conversationsLabel = '',
}) => {
  const localize = useLocalize();
  const resolvedConversationsLabel =
    conversationsLabel ||
    localize('chat.search.conversations');

  const panelRef =
    useRef<HTMLDivElement | null>(null);

           
  useEffect(() => {
    if (!visible) return;

    const handler = (e: MouseEvent) => {
      const a = anchorRef.current;
      const p = panelRef.current;
      const target = e.target as Node;

      if (a && a.contains(target)) return;
      if (p && p.contains(target)) return;

      onClose();
    };

    document.addEventListener(
      'mousedown',
      handler,
    );

    return () =>
      document.removeEventListener(
        'mousedown',
        handler,
      );
  }, [
    visible,
    anchorRef,
    onClose,
  ]);

  if (!visible) return null;

  return (
    <div
      ref={panelRef}
      className={`
        absolute z-[120]
        shadow-xl border rounded-[12px]
        overflow-y-auto overflow-x-hidden
        box-border flex flex-col
        ${
          'bg-[#ffffff] border-[#e9ecf3] text-theme-primary dark:bg-[#141414] dark:border-[#242424] '
        }
      `}
      style={{
        top: 'calc(100% + 5px)',
        left: 0,
        width: 'min(720px, 100%)',
        height: '400px',
        maxWidth: '100%',
      }}
    >
      {                               }
      <div
        className="sticky top-0 z-10 bg-[#ffffff] dark:bg-[#141414]"
      >
        {                }
        <div className="p-2 mb-[5px] mt-[5px]">
          <ChatPanelSearchDropdownItem
            avatarUrl={resolveAssetUrl('/icons/find.svg')}
            title={localize(
              'chat.search.browserTitle',
              {
                query,
              },
            )}
            subtitle={localize(
              'chat.search.browserSubtitle',
            )}

            onClick={() => {
              onWebSearch(query);
              onClose();
            }}
            scaleWithContainer
          />
        </div>

        {         }
        <div
          className="mb-[10px] border-b border-[#e9ecf3] dark:border-[#242424]"
        />
      </div>

      {          }
      <div className="flex-1 overflow-y-auto">
        {        }
        {agents.length > 0 && (
          <div>
            <div
              className={`px-[10px] text-[11px] opacity-60 ${
                'text-[#667085] dark:text-[#c9cdd4]'
              }`}
            >
              {localize(
                'chat.search.agents',
              )}
            </div>

            {agents.map((a) => (
              <ChatPanelSearchDropdownItem
                key={a.id}
                avatarUrl={
                  a.avatarUrl
                }
                title={
                  a.remark ||
                  a.name
                }
                subtitle={
                  a.lastMessage ||
                  localize(
                    'chat.defaultGreeting',
                  )
                }

                onClick={() => {
                  onPickAgent(
                    a.id,
                  );
                  onClose();
                }}
                scaleWithContainer
              />
            ))}
          </div>
        )}

        {        }
        {conversations.length >
          0 && (
          <div>
            <div
              className={`px-[10px] text-[11px] opacity-60 mt-[10px] ${
                'text-[#667085] dark:text-[#c9cdd4]'
              }`}
            >
              {
                resolvedConversationsLabel
              }
            </div>

            {conversations.map(
              (c) => (
                <ChatPanelSearchDropdownItem
                  key={c.id}
                  avatarUrl={
                    c.avatarUrl ||
                    resolveAssetUrl('/icons/chat.svg')
                  }
                  title={
                    c.title
                  }
                  subtitle={
                    c.snippet ||
                    '……'
                  }

                  onClick={() => {
                    onPickConversation(
                      c.id,
                      c.agentId,
                    );
                    onClose();
                  }}
                  scaleWithContainer
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatPanelSearchDropdown;