                                                     
import { localizeText } from '../../../localization/localization';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

import {
  ensureTitleFromDB,
  generateTitleBySeed,
  renameChatTitle,
  listChatTitles,
  getChatTitle,
  TitleInfo,
  TitleListResp,
  TitleListItem,
} from '../../../lib/chat-api';

const TAG = '[ChatTitle]';

const DEFAULT_PLACEHOLDER = '';
const isPlaceholderTitle = (value: unknown): boolean => !String(value ?? '').trim();

type UseChatTitleOptions = {
  userId?: string | null;
  socket?: Socket | null;
  onTitleChange?: (p: {
    conversationId: string;
    title: string;
    titleVersion: number;
    titleUpdatedAt: string;
  }) => void;
  onListPatched?: (agentId: string, items: TitleListItem[]) => void;
  optimisticRename?: boolean;
};

export function useChatTitle(
  agentId: string | null | undefined,
  conversationId: string | null | undefined,
  opts: UseChatTitleOptions = {}
) {
  const {
    userId = null,
    socket: externalSocket = null,
    onTitleChange,
    onListPatched,
    optimisticRename = true,
  } = opts;

               
  const [title, setTitle] = useState<string>(DEFAULT_PLACEHOLDER);
  const [titleVersion, setTitleVersion] = useState<number>(0);
  const [titleUpdatedAt, setTitleUpdatedAt] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [editing, setEditing] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const [listCache, setListCache] = useState<
    Record<
      string,
      {
        items: TitleListItem[];
        nextCursor: string | null;
        loading: boolean;
      }
    >
  >({});

  const socketRef = useRef<Socket | null>(null);
  useEffect(() => {
    socketRef.current = externalSocket;
    if (externalSocket && userId) externalSocket.emit('join_user_room', { userId });
    return () => {
      socketRef.current = null;
    };
  }, [externalSocket, userId]);

  useEffect(() => {
    setError('');
    setEditing(false);
                                                                                     
  }, [conversationId]);

  const patchCurrent = useCallback(
    (p: { conversationId: string; title: string; titleVersion: number; titleUpdatedAt: string }) => {
      if (!conversationId) {
                                                                                                 
        return;
      }
      if (p.conversationId !== conversationId) {
                                                                                                         
        return;
      }
                                          
      setTitle(p.title);
      setTitleVersion(p.titleVersion);
      setTitleUpdatedAt(p.titleUpdatedAt);
      onTitleChange?.(p);
    },
    [conversationId, onTitleChange]
  );

  const patchListItem = useCallback(
    (agent: string | undefined, convId: string, nextTitle: string, nextVer: number, nextAt: string) => {
      if (!agent) return;
      setListCache((prev) => {
        const bucket = prev[agent];
        if (!bucket) return prev;
        const idx = bucket.items.findIndex((x) => x.id === convId);
        if (idx < 0) return prev;

        const nextItems = [...bucket.items];
        nextItems[idx] = {
          ...nextItems[idx],
          title: nextTitle,
          titleVersion: nextVer,
          titleUpdatedAt: nextAt,
        };
                                           
                
                 
                                     
                                
           

        const nextBucket = { ...bucket, items: nextItems };
        const nextCache = { ...prev, [agent]: nextBucket };
        onListPatched?.(agent, nextItems);
        return nextCache;
      });
    },
    [onListPatched]
  );

                                                                 
                                                                             
                                                           
  useEffect(() => {
    const applyTitlePayload = (payload: any) => {
      if (!payload?.conversationId || !payload?.title) return;
      const nextVersion = Number(payload.titleVersion ?? 1);
      const nextUpdatedAt = String(payload.titleUpdatedAt ?? new Date().toISOString());

      patchCurrent({
        conversationId: String(payload.conversationId),
        title: String(payload.title),
        titleVersion: nextVersion,
        titleUpdatedAt: nextUpdatedAt,
      });

      patchListItem(
        payload.agentId ? String(payload.agentId) : undefined,
        String(payload.conversationId),
        String(payload.title),
        nextVersion,
        nextUpdatedAt,
      );
    };

    const onCreated = (event: Event) => applyTitlePayload((event as CustomEvent).detail);
    const onUpdated = (event: Event) => applyTitlePayload((event as CustomEvent).detail);

    window.addEventListener('chat:title:created', onCreated as EventListener);
    window.addEventListener('chat:title:updated', onUpdated as EventListener);

    return () => {
      window.removeEventListener('chat:title:created', onCreated as EventListener);
      window.removeEventListener('chat:title:updated', onUpdated as EventListener);
    };
  }, [patchCurrent, patchListItem]);

          
  useEffect(() => {
    const s = socketRef.current;
    if (!s) return;

    const onCreated = (payload: {
      conversationId: string;
      title: string;
      agentId?: string;
      titleVersion: number;
      titleUpdatedAt: string;
    }) => {
                                                                             
      patchCurrent({
        conversationId: payload.conversationId,
        title: payload.title,
        titleVersion: payload.titleVersion,
        titleUpdatedAt: payload.titleUpdatedAt,
      });
      patchListItem(
        payload.agentId,
        payload.conversationId,
        payload.title,
        payload.titleVersion,
        payload.titleUpdatedAt
      );
    };

    const onUpdated = (payload: {
      conversationId: string;
      title: string;
      titleVersion: number;
      titleUpdatedAt: string;
      agentId?: string;
    }) => {
                                                                             
      patchCurrent({
        conversationId: payload.conversationId,
        title: payload.title,
        titleVersion: payload.titleVersion,
        titleUpdatedAt: payload.titleUpdatedAt,
      });
      patchListItem(
        payload.agentId,
        payload.conversationId,
        payload.title,
        payload.titleVersion,
        payload.titleUpdatedAt
      );
    };

    s.on('CHAT_TITLE_CREATED', onCreated);
    s.on('CHAT_TITLE_UPDATED', onUpdated);
    return () => {
      s.off('CHAT_TITLE_CREATED', onCreated);
      s.off('CHAT_TITLE_UPDATED', onUpdated);
    };
  }, [patchCurrent, patchListItem, conversationId]);

                                                
  const generateBySeed = useCallback(
    async (seed: string, convId?: string): Promise<TitleInfo> => {
      const id = convId ?? conversationId;
      if (!id) throw new Error(localizeText('chat.title.missingConversationId'));
      if (!seed?.trim()) throw new Error(localizeText('chat.title.missingSeed'));

      setLoading(true);
      setError('');
                                                                                           
      try {
        const t = await generateTitleBySeed({ conversationId: id, seed, strategy: 'FIRST_MESSAGE' });
                                                         

        patchCurrent({
          conversationId: t.conversationId,
          title: t.title,
          titleVersion: t.titleVersion,
          titleUpdatedAt: t.titleUpdatedAt,
        });
        patchListItem(t.agentId, t.conversationId, t.title, t.titleVersion, t.titleUpdatedAt);
        return t;
      } catch (e: any) {
        console.warn(TAG, 'generateBySeed → error', e?.message || e);
        setError(e?.message || localizeText('chat.title.generateFailed'));
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [conversationId, patchCurrent, patchListItem]
  );

                                               
  const createFromFirstMessage = useCallback(
    async (_firstMessage: string, convId?: string): Promise<TitleInfo> => {
      const id = convId ?? conversationId;
      if (!agentId) throw new Error(localizeText('chat.title.missingAgentId'));
      if (!id) throw new Error(localizeText('chat.title.missingConversationId'));

      setLoading(true);
      setError('');
                                                                                                            
      try {
        const t = await ensureTitleFromDB(id);
                                                            

        patchCurrent({
          conversationId: t.conversationId,
          title: t.title,
          titleVersion: t.titleVersion,
          titleUpdatedAt: t.titleUpdatedAt,
        });
        patchListItem(t.agentId, t.conversationId, t.title, t.titleVersion, t.titleUpdatedAt);
        return t;
      } catch (e: any) {
        console.warn(TAG, 'ensureTitleFromDB → error', e?.message || e);
        setError(e?.message || localizeText('chat.title.createFailed'));
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [agentId, conversationId, patchCurrent, patchListItem]
  );

        
  const rename = useCallback(
    async (nextTitle: string): Promise<TitleInfo> => {
      if (!conversationId) throw new Error(localizeText('chat.title.missingConversationId'));
      const trimmed = (nextTitle || '').trim();
      if (!trimmed) throw new Error(localizeText('chat.title.empty'));

      setError('');
      const old = { title, titleVersion, titleUpdatedAt };

      if (optimisticRename) {
        setTitle(trimmed);
        setTitleVersion((v) => v + 1);
        setTitleUpdatedAt(new Date().toISOString());
      }

                                                                                                  
      try {
        const resp = await renameChatTitle(conversationId, { title: trimmed, titleVersion });
                                                    

        patchCurrent({
          conversationId: resp.conversationId,
          title: resp.title,
          titleVersion: resp.titleVersion,
          titleUpdatedAt: resp.titleUpdatedAt,
        });
        if (agentId) {
          patchListItem(agentId, conversationId, resp.title, resp.titleVersion, resp.titleUpdatedAt);
        }
        return resp;
      } catch (e: any) {
        console.warn(TAG, 'rename → error', e?.message || e);
        if (optimisticRename) {
          setTitle(old.title);
          setTitleVersion(old.titleVersion);
          setTitleUpdatedAt(old.titleUpdatedAt);
        }
        if (e?.response?.status === 409 || e?.status === 409) {
          try {
            const latest = await getChatTitle(conversationId);
                                                                 
            patchCurrent({
              conversationId,
              title: latest.title,
              titleVersion: latest.titleVersion,
              titleUpdatedAt: latest.titleUpdatedAt,
            });
          } catch {}
          const err: any = new Error(localizeText('chat.title.conflict'));
          err.code = 'CONFLICT';
          setError(err.message);
          throw err;
        }
        setError(e?.message || localizeText('chat.title.renameFailed'));
        throw e;
      }
    },
    [conversationId, title, titleVersion, titleUpdatedAt, optimisticRename, patchCurrent, agentId, patchListItem]
  );

     
               
                               
                 
     
  const fetchListByAgent = useCallback(
    async ({ cursor, limit = 20 }: { cursor?: string | null; limit?: number } = {}) => {
      if (!agentId) {
                                                                 
        throw new Error(localizeText('chat.title.missingAgentId'));
      }

      setListCache((prev) => ({
        ...prev,
        [agentId]: {
          items: prev[agentId]?.items || [],
          nextCursor: prev[agentId]?.nextCursor ?? null,
          loading: true,
        },
      }));

                                                                               
      try {
        const resp: TitleListResp = await listChatTitles(agentId, { cursor: cursor ?? null, limit });
                                                                                                                  

        setListCache((prev) => {
          const oldItems = prev[agentId]?.items || [];
          const isFirstPage = !cursor;

          let nextItems: TitleListItem[];
          if (isFirstPage) {
                                     
            nextItems = resp.items;
          } else {
                        
            const map = new Map<string, TitleListItem>();
            [...oldItems, ...resp.items].forEach((it) => map.set(it.id, it));
            nextItems = Array.from(map.values());
          }

          const next = {
            items: nextItems,
            nextCursor: resp.nextCursor,
            loading: false,
          };
          onListPatched?.(agentId, nextItems);
          return { ...prev, [agentId]: next };
        });

        return resp;
      } catch (e: any) {
        console.warn(TAG, 'listChatTitles → error', e?.message || e);
        setListCache((prev) => ({
          ...prev,
          [agentId]: {
            items: prev[agentId]?.items || [],
            nextCursor: prev[agentId]?.nextCursor ?? null,
            loading: false,
          },
        }));
        throw e;
      }
    },
    [agentId, onListPatched]
  );

  const getOne = useCallback(async (convId?: string) => {
    const id = convId || conversationId;
    if (!id) throw new Error(localizeText('chat.title.missingConversationId'));
                                                       
    const info = await getChatTitle(id);
                                                      
    return info;
  }, [conversationId]);

  const setLocalPlaceholder = useCallback(
    (p: {
      conversationId: string;
      title?: string;
      titleVersion?: number;
      titleUpdatedAt?: string;
    }) => {
      if (!p?.conversationId || p.conversationId !== conversationId) {
                                                                                               
        return;
      }
      const nextTitle = (p.title && p.title.trim()) || DEFAULT_PLACEHOLDER;
      const nextVersion = typeof p.titleVersion === 'number' ? p.titleVersion : 1;
      const nextAt = p.titleUpdatedAt || new Date().toISOString();

                                                                                    
      setTitle(nextTitle);
      setTitleVersion(nextVersion);
      setTitleUpdatedAt(nextAt);
      onTitleChange?.({
        conversationId: p.conversationId,
        title: nextTitle,
        titleVersion: nextVersion,
        titleUpdatedAt: nextAt,
      });
    },
    [conversationId, onTitleChange]
  );

  const isDefaultTitle = useMemo(
    () => isPlaceholderTitle(title) || !titleVersion,
    [title, titleVersion]
  );

  const currentList = agentId ? listCache[agentId] : undefined;

  return {
    title,
    titleVersion,
    titleUpdatedAt,
    isDefaultTitle,
    loading,
    error,
    editing,
    setEditing,
                    
    createFromFirstMessage,                 
    generateBySeed,                             
    rename,
    fetchListByAgent,
    getOne,
    list: currentList?.items || [],
    listLoading: currentList?.loading || false,
    nextCursor: currentList?.nextCursor || null,
    setLocalPlaceholder,
  };
}
