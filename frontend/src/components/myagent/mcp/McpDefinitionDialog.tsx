// frontend/src/components/myagent/mcp/McpDefinitionDialog.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocalize } from '../../../localization/useLocalize';
import type { McpDefinitionDetail, McpDefinitionDraft } from './mcp.types';
const TRANSITION_MS = 200;
const emptyDraft: McpDefinitionDraft = {
  displayName: '',
  description: '',
  transport: 'streamable_http',
  endpoint: '',
  command: '',
  argsText: '',
  workingDirectory: '',
  authKind: 'none',
  headersText: '',
  environmentText: '',
  timeoutMs: 30_000,
};
export default function McpDefinitionDialog({
    open,
  definition,
  busy,
  onClose,
  onSave,
}: {

  open: boolean;
  definition: McpDefinitionDetail | null;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: McpDefinitionDraft) => void;
}) {
  const localize = useLocalize();
  const portalContainer = useMemo(
    () => document.getElementById('shell-portal') ?? document.body,
    [],
  );
  const closeTimerRef = useRef<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [closing, setClosing] = useState(false);
  const [draft, setDraft] = useState<McpDefinitionDraft>(emptyDraft);
                                               
  useEffect(() => {
    if (!open) {
      setShowModal(false);
      setClosing(false);
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      return;
    }

    setClosing(false);
    const frame = requestAnimationFrame(() => {
      setShowModal(true);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [open]);
                                              
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);
                                             
  useEffect(() => {
    setDraft(
      definition
        ? {
            displayName: definition.displayName,
            description: definition.description,
            transport: definition.transport,
            endpoint: definition.endpoint ?? '',
            command: definition.command ?? '',
            argsText: (definition.args ?? []).join('\n'),
            workingDirectory: definition.workingDirectory ?? '',
            authKind: definition.authKind,
            headersText: (definition.declaredHeaderKeys ?? []).join('\n'),
            environmentText: (definition.declaredEnvironmentKeys ?? []).join('\n'),
            timeoutMs: definition.timeoutMs ?? 30_000,
          }
        : emptyDraft,
    );
  }, [definition, open]);
                                            
  const requestClose = useCallback(() => {
    if (busy || closing) return;
    setClosing(true);
    setShowModal(false);
    closeTimerRef.current = window.setTimeout(onClose, TRANSITION_MS);
  }, [busy, closing, onClose]);
                                                
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, requestClose]);
                                                
  const inputClass = `
    box-border h-[30px] w-full rounded-[9px] border-[0.5px] px-[10px] text-[12px] outline-none
    transition-colors disabled:cursor-not-allowed disabled:opacity-50
    ${
      'border-edge-soft bg-surface-soft text-theme-primary placeholder:text-[#999999]    dark:placeholder:text-[#666666]'
    }
  `;
  const textareaClass = `
    box-border w-full rounded-[9px] border-[0.5px] px-[9px] py-[10px] text-[12px] outline-none resize-none
    transition-colors disabled:cursor-not-allowed disabled:opacity-50 font-mono
    ${
      'border-edge-soft bg-surface-soft text-theme-primary placeholder:text-[#999999]    dark:placeholder:text-[#666666]'
    }
  `;
  if (!open) return null;
                                               
  const modalNode = (
    <div
      data-desktop-no-drag
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        pointerEvents: 'none',
        opacity: showModal ? 1 : 0,
        transition: `opacity ${TRANSITION_MS}ms ease`,
      }}
    >
      {        }
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'auto',
          background: 'rgba(0,0,0,0.4)',
          backdropFilter: 'blur(3px)',
          WebkitBackdropFilter: 'blur(3px)',
        }}
        onMouseDown={requestClose}
      />
      {          }
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          padding: 12,
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mcp-definition-dialog-title"
          className={`
            pointer-events-auto relative flex overflow-hidden rounded-[14px] border-[0.5px] shadow-2xl
            ${'border-edge-strong bg-surface-raised text-theme-primary   '}
          `}
          style={{
            width: 560,
            height: 'calc(68vh + 40px)',
            maxHeight: 'calc(100vh - 24px)',
            transform: showModal ? 'scale(1)' : 'scale(0.96)',
            opacity: showModal ? 1 : 0.96,
            transition: [
              `transform ${TRANSITION_MS}ms ease`,
              `opacity ${TRANSITION_MS}ms ease`,
            ].join(', '),
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex min-w-0 flex-1 flex-col">
            {                                          }
            <header
              className={`
                flex shrink-0 items-center justify-between border-b-[0.5px]
                ${'border-edge-strong '}
                px-[14px] py-[10px]
              `}
            >
              <div className="select-none">
                <div
                  id="mcp-definition-dialog-title"
                  className="text-[15px] font-semibold"
                >
                  {definition ? localize('mcp.definition.editTitle') : localize('mcp.definition.addTitle')}
                </div>
                <div className="mt-[3px] text-[9px] opacity-60">
                  {localize('mcp.definition.description')}
                </div>
              </div>
              <button
                type="button"
                onClick={requestClose}
                disabled={busy || closing}
                className={`
                  select-none rounded-[7px] border-0 px-[8px] py-[5px] text-[10px] outline-none
                  transition-colors disabled:cursor-not-allowed disabled:opacity-40
                  ${'hover:bg-surface-hover-strong '}
                `}
              >
                {localize('common.actions.close')}
              </button>
            </header>
            {                                      }
            <div className="min-h-0 flex-1 overflow-y-auto px-[14px] py-[18px]">
              <div className="space-y-[10px]">
                {                   }
                <div className="grid h-[30px] grid-cols-2 gap-[10px]">
                  <input
                    className={inputClass}
                    placeholder={localize('mcp.definition.namePlaceholder')}
                    value={draft.displayName}
                    onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                  />
                  <select
                    className={inputClass}
                    value={draft.transport}
                    onChange={(event) => {
                      const transport = event.target.value as McpDefinitionDraft['transport'];
                      setDraft({
                        ...draft,
                        transport,
                        authKind:
                          transport === 'stdio'
                            ? draft.environmentText.trim()
                              ? 'environment'
                              : 'none'
                            : draft.authKind === 'environment'
                              ? 'none'
                              : draft.authKind,
                      });
                    }}
                  >
                    <option value="streamable_http">{localize('mcp.transport.streamableHttp')}</option>
                    <option value="stdio">{localize('mcp.transport.stdio')}</option>
                  </select>
                </div>
                {        }
                <textarea
                  className={`${textareaClass} h-[90px]`}
                  placeholder={localize('mcp.definition.descriptionPlaceholder')}
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
                {                   }
                {draft.transport === 'streamable_http' ? (
                  <input
                    className={`${inputClass} h-[30px]`}
                    placeholder={localize('mcp.definition.urlPlaceholder')}
                    value={draft.endpoint}
                    onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })}
                  />
                ) : (
                  <>
                    <div className="grid h-[30px] grid-cols-2 gap-[10px]">
                      <input
                        className={`${inputClass} h-[30px]`}
                        placeholder={localize('mcp.definition.commandPlaceholder')}
                        value={draft.command}
                        onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                      />
                      <input
                        className={inputClass}
                        placeholder={localize('mcp.definition.workingDirectoryPlaceholder')}
                        value={draft.workingDirectory}
                        onChange={(event) => setDraft({ ...draft, workingDirectory: event.target.value })}
                      />
                    </div>
                    <textarea
                      className={`${textareaClass} h-[90px]`}
                      placeholder={localize('mcp.definition.argsPlaceholder')}
                      value={draft.argsText}
                      onChange={(event) => setDraft({ ...draft, argsText: event.target.value })}
                    />
                  </>
                )}
                {             }
                <div className="grid h-[30px] grid-cols-2 gap-[10px]">
                  <select
                    className={`${inputClass} ！pr-[30px]`}
                    value={draft.authKind}
                    onChange={(event) =>
                      setDraft({ ...draft, authKind: event.target.value as McpDefinitionDraft['authKind'] })
                    }
                  >
                    <option value="none">{localize('mcp.auth.none')}</option>
                    {draft.transport === 'stdio' ? (
                      <option value="environment">{localize('mcp.auth.environment')}</option>
                    ) : (
                      <>
                        <option value="oauth2">{localize('mcp.auth.oauth2')}</option>
                        <option value="bearer">{localize('mcp.auth.bearerToken')}</option>
                        <option value="api_key">{localize('mcp.auth.apiKey')}</option>
                        <option value="custom_headers">{localize('mcp.auth.customHeaders')}</option>
                      </>
                    )}
                  </select>
                  <input
                    className={inputClass}
                    type="number"
                    min={1000}
                    max={300000}
                    value={draft.timeoutMs}
                    onChange={(event) => setDraft({ ...draft, timeoutMs: Number(event.target.value) || 30000 })}
                  />
                </div>
                {                      }
                {draft.transport === 'streamable_http' &&
                  ['api_key', 'custom_headers'].includes(draft.authKind) && (
                    <textarea
                      className={`${textareaClass} h-[90px]`}
                      placeholder={
                        draft.authKind === 'api_key'
                          ? localize('mcp.definition.apiKeyHeaderPlaceholder')
                          : localize('mcp.definition.headerNamesPlaceholder')
                      }
                      value={draft.headersText}
                      onChange={(event) => setDraft({ ...draft, headersText: event.target.value })}
                    />
                  )}
                {draft.transport === 'stdio' && draft.authKind === 'environment' && (
                  <textarea
                    className={`${textareaClass} h-[90px]`}
                    placeholder={localize('mcp.definition.environmentKeysPlaceholder')}
                    value={draft.environmentText}
                    onChange={(event) => setDraft({ ...draft, environmentText: event.target.value })}
                  />
                )}
                {          }
                {draft.transport === 'stdio' ? (
                  <p className={`text-[10px] leading-5 ${'text-theme-quiet '}`}>
                    {localize('mcp.definition.stdioHint')}
                  </p>
                ) : draft.authKind === 'oauth2' ? (
                  <p className={`text-[10px] leading-5 ${'text-theme-quiet '}`}>
                    {localize('mcp.definition.oauthHint')}
                  </p>
                ) : null}
              </div>
            </div>
            {                                           }
            <footer
              className={`
                flex shrink-0 items-center justify-end gap-[7px] border-t-[0.5px]
                ${'border-edge-strong '}
                px-[12px] py-[8px]
                ${'bg-surface-raised '}
              `}
            >
              <button
                type="button"
                onClick={requestClose}
                disabled={busy || closing}
                className={`
                  select-none rounded-[7px] border-0 px-[10px] py-[6px] text-[10px] outline-none
                  transition-colors disabled:cursor-not-allowed disabled:opacity-40
                  ${'hover:bg-surface-hover-strong '}
                `}
              >
                {localize('common.actions.cancel')}
              </button>
              <button
                type="button"
                disabled={busy || !draft.displayName.trim()}
                onClick={() => onSave(draft)}
                className="
                  select-none rounded-[7px] border-0 bg-action-primary px-[12px] py-[6px]
                  text-[10px] text-[#ffffff] outline-none transition-opacity
                  hover:text-[#ffffff] disabled:cursor-not-allowed disabled:opacity-40
                "
              >
                {busy ? localize('common.saving') : localize('common.actions.save')}
              </button>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
  return createPortal(modalNode, portalContainer);
}