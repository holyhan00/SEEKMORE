import { useAppearance } from '../../../theme/useAppearance';
                                                          

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocalize } from '../../../localization/useLocalize';
import { PrismAsync as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
  codeHighlightDark,
  codeHighlightLight,
} from '../../markdown/renderers/CodeRenderer/codeHighlightTheme';

const TRANSITION_MS = 200;

const DEFAULT_JSON = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/path/to/allowed/dir"
      ]
    }
  }
}`;

export default function McpImportDialog({
    open,
  busy,
  importPreview,
  error,
  onClose,
  onImport,
}: {

  open: boolean;
  busy: boolean;
  importPreview: Array<Record<string, unknown>>;
  error: string | null;
  onClose: () => void;
  onImport: (text: string) => Promise<void>;
}) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();
  const portalContainer = useMemo(
    () => document.getElementById('shell-portal') ?? document.body,
    [],
  );
  const closeTimerRef = useRef<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [closing, setClosing] = useState(false);
  const [importText, setImportText] = useState('');

                                               
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShowModal(true));
    return () => {
      cancelAnimationFrame(frame);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

                                              
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

                                            
  useEffect(() => {
    if (open) setImportText(DEFAULT_JSON);
  }, [open]);

                                            
  const requestClose = useCallback(() => {
    if (busy || closing) return;
    setClosing(true);
    setShowModal(false);
    closeTimerRef.current = window.setTimeout(onClose, TRANSITION_MS);
  }, [busy, closing, onClose]);

                                                
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [requestClose]);

  if (!open) return null;

                                               
  const themeBg = isDarkTheme ? '#1e1e1e' : '#ffffff';
  const themeBorder = isDarkTheme ? '#303030' : '#e6e6e6';
  const textareaBg = isDarkTheme ? '#151515' : '#fafafa';
  const previewBg = isDarkTheme ? '#1a1a1a' : '#f5f5f5';

  const modalNode = (
    <div
      data-desktop-no-drag
      style={{
        position: 'fixed', inset: 0, zIndex: 100000, pointerEvents: 'none',
        opacity: showModal ? 1 : 0,
        transition: `opacity ${TRANSITION_MS}ms ease`,
      }}
    >
      {        }
      <div
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'auto',
          background: 'rgba(0,0,0,0.4)',
          backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
        }}
        onMouseDown={requestClose}
      />

      {        }
      <div style={{
        position: 'absolute', inset: 0, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none', padding: 12,
      }}>
        <div
          role="dialog" aria-modal="true" aria-labelledby="mcp-import-dialog-title"
          className="pointer-events-auto relative flex overflow-hidden rounded-[14px] border-[0.5px] shadow-2xl"
          style={{
            width: 680,
            maxHeight: 'calc(100vh - 24px)',
            background: themeBg,
            borderColor: themeBorder,
            color: isDarkTheme ? '#ffffff' : '#000000',
            transform: showModal ? 'scale(1)' : 'scale(0.96)',
            opacity: showModal ? 1 : 0.96,
            transition: `transform ${TRANSITION_MS}ms ease, opacity ${TRANSITION_MS}ms ease`,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex min-w-0 flex-1 flex-col">
            {            }
            <header
              className="flex shrink-0 items-center justify-between border-b-[0.5px] px-[14px] py-[10px]"
              style={{ borderColor: themeBorder }}
            >
              <div className="select-none">
                <div id="mcp-import-dialog-title" className="text-[15px] font-semibold">
                  {localize('mcp.import.title')}
                </div>
                <div className="mt-[3px] text-[9px] opacity-60">
                   {localize('mcp.import.description')}
                </div>
              </div>
              <button
                type="button" onClick={requestClose} disabled={busy || closing}
                className="select-none rounded-[7px] border-0 px-[8px] py-[5px] text-[10px] outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[#2b2b2b]"
              >
                {localize('common.actions.close')}
              </button>
            </header>

            {             }
            <div className="min-h-0 flex-1 overflow-y-auto px-[14px] py-[18px]">
              <div className="space-y-[10px]">
                <p className="text-[10px] leading-5 opacity-50">
                  {localize('mcp.import.safetyHint')}
                </p>

                {                                      }
                <div>
                  <textarea
                    className="box-border w-full resize-none rounded-[9px] border-[0.5px] px-[12px] py-[10px] font-mono text-[12px] leading-[20px] outline-none transition-colors"
                    style={{
                      background: textareaBg,
                      borderColor: themeBorder,
                      color: isDarkTheme ? '#d4d4d4' : '#333333',
                      minHeight: 140,
                      tabSize: 2,
                    }}
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    rows={8}
                    spellCheck={false}
                    disabled={busy}
                  />
                </div>

                {               }
                <div>
                  <div
                    className="overflow-hidden rounded-[9px] border-[0.5px]"
                    style={{ borderColor: themeBorder, background: previewBg }}
                  >
                    <SyntaxHighlighter
                      language="json"
                      style={isDarkTheme ? codeHighlightDark : codeHighlightLight}
                      customStyle={{
                        background: 'transparent',
                        padding: '10px 12px',
                        margin: 0,
                        borderRadius: 0,
                        border: 'none',
                        maxHeight: 220,
                        overflow: 'auto',
                        fontSize: '12px',
                        lineHeight: '20px',
                        fontFamily: "'SF Mono', 'Fira Code', 'Fira Mono', Menlo, Consolas, monospace",
                      }}
                      codeTagProps={{
                        style: {
                          fontSize: '12px',
                          lineHeight: '20px',
                          fontFamily: "'SF Mono', 'Fira Code', 'Fira Mono', Menlo, Consolas, monospace",
                        },
                      }}
                      PreTag="div"
                    >
                      {importText || ' '}
                    </SyntaxHighlighter>
                  </div>
                </div>

                {          }
                {error && (
                  <div className="rounded-[9px] bg-red-500/10 px-[10px] py-[8px] text-[10px] text-red-500">
                    {error}
                  </div>
                )}

                {            }
                {importPreview.length > 0 && (
                  <div className="rounded-[9px] bg-emerald-500/10 px-[10px] py-[8px] text-[10px] text-emerald-500">
                    {localize('mcp.import.willCreate', { names: importPreview.map((i) => String(i.displayName ?? i.name ?? '')).join(', ') })}
                  </div>
                )}
              </div>
            </div>

            {            }
            <footer
              className="flex shrink-0 items-center justify-end gap-[7px] border-t-[0.5px] px-[12px] py-[8px]"
              style={{ borderColor: themeBorder }}
            >
              <button
                type="button" onClick={requestClose} disabled={busy || closing}
                className="select-none rounded-[7px] border-0 px-[10px] py-[6px] text-[10px] outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[#2b2b2b]"
              >
                {localize('common.actions.cancel')}
              </button>
              <button
                type="button" disabled={busy || !importText.trim()}
                onClick={async () => { await onImport(importText); }}
                className="select-none rounded-[7px] border-0 bg-action-primary px-[12px] py-[6px] text-[10px] text-[#ffffff] outline-none transition-opacity hover:text-[#ffffff] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? localize('mcp.import.importing') : localize('mcp.import.confirm')}
              </button>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalNode, portalContainer);
}
