import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { McpInstallationItem } from './mcp.types';
import { useLocalize } from '../../../localization/useLocalize';

const TRANSITION_MS = 200;

interface McpCredentialField {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  sensitive: boolean;
}

function credentialFieldLabel(
  key: string,
  localize: ReturnType<typeof useLocalize>,
): string {
  const normalized = key.toUpperCase();
  if (normalized === 'TOKEN' || normalized.includes('TOKEN')) return localize('mcp.credential.token');
  if (normalized === 'APP_ID') return 'App ID';
  if (normalized === 'APP_SECRET') return 'App Secret';
  if (normalized.includes('CLIENT_ID')) return 'Client ID';
  if (normalized.includes('CLIENT_SECRET')) return 'Client Secret';
  if (normalized.includes('SECRETID') || normalized.includes('SECRET_ID')) return 'SecretId';
  if (normalized.includes('SECRETKEY') || normalized.includes('SECRET_KEY')) return 'SecretKey';
  if (normalized.includes('ACCESS_KEY_ID')) return 'AccessKey ID';
  if (normalized.includes('ACCESS_KEY_SECRET')) return 'AccessKey Secret';
  if (normalized.includes('ENDPOINT') || normalized.includes('SERVER_URL')) return localize('mcp.credential.endpoint');
  if (normalized.includes('CONNECTION_STRING')) return localize('mcp.credential.connectionString');
  if (normalized === 'REDIS_URL') return 'Redis URL';
  if (normalized.includes('ENV_ID')) return localize('mcp.credential.environmentId');
  if (normalized.includes('USER_NAME') || normalized.includes('USERNAME')) return localize('mcp.credential.username');
  if (normalized.includes('AUTHORIZATION')) return localize('mcp.credential.authorizationHeader');
  if (normalized.includes('API_KEY') || normalized.endsWith('_KEY')) return 'API Key';
  return key;
}

function credentialFieldDescription(
  key: string,
  localize: ReturnType<typeof useLocalize>,
): string {
  const normalized = key.toUpperCase();
  if (normalized.includes('ENDPOINT') || normalized.includes('SERVER_URL')) {
    return localize('mcp.credential.endpointDescription');
  }
  if (normalized.includes('CONNECTION_STRING')) return localize('mcp.credential.connectionStringDescription');
  if (normalized === 'REDIS_URL') return localize('mcp.credential.redisUrlDescription');
  if (normalized.includes('ENV_ID')) return localize('mcp.credential.environmentIdDescription');
  if (normalized.includes('USER_NAME') || normalized.includes('USERNAME')) {
    return localize('mcp.credential.usernameDescription');
  }
  if (normalized.includes('AUTHORIZATION')) {
    return localize('mcp.credential.authorizationDescription');
  }
  return localize('mcp.credential.secretDescription');
}

function parseCredentialLines(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of value.split('\n')) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const itemValue = line.slice(index + 1).trim();
    if (key && itemValue) result[key] = itemValue;
  }
  return result;
}

function credentialFields(
  item: McpInstallationItem,
  localize: ReturnType<typeof useLocalize>,
): McpCredentialField[] {
  let keys = item.requiredConfigurationKeys.length > 0
    ? item.requiredConfigurationKeys
    : item.transport === 'stdio'
      ? item.declaredEnvironmentKeys
      : item.declaredHeaderKeys;

  if (item.authKind === 'bearer') keys = ['token'];
  if (item.authKind === 'api_key' && keys.length === 0) keys = ['apiKey'];

  return [...new Set(keys)].map((key) => {
    const normalized = key.toUpperCase();
    const endpoint = normalized.includes('ENDPOINT') || normalized.includes('SERVER_URL');
    const identifier = normalized.includes('ENV_ID')
      || normalized.includes('USER_NAME')
      || normalized.includes('USERNAME');
    return {
      key,
      label: credentialFieldLabel(key, localize),
      description: credentialFieldDescription(key, localize),
      placeholder: endpoint ? 'https://…' : identifier ? key : localize('common.inputPlaceholder'),
      sensitive: !endpoint && !identifier,
    };
  });
}

export default function McpCredentialDialog({
    installation,
  busy,
  error,
  onClose,
  onSave,
}: {

  installation: McpInstallationItem;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: Record<string, string>) => Promise<void>;
}) {
  const localize = useLocalize();
  const configurationHint = installation.configurationHintPresentation?.key
    ? localize(installation.configurationHintPresentation.key, {
        ...(installation.configurationHintPresentation.params ?? {}),
        defaultValue: installation.configurationHint,
      })
    : installation.configurationHint;
  const portalContainer = useMemo(
    () => document.getElementById('shell-portal') ?? document.body,
    [],
  );
  const closeTimerRef = useRef<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [closing, setClosing] = useState(false);
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [credentialRawText, setCredentialRawText] = useState('');

                                               
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setShowModal(true);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

                                              
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

                                                 
  useEffect(() => {
    setCredentialValues({});
    setCredentialRawText('');
  }, [installation.id]);

                                            
  const requestClose = useCallback(() => {
    if (busy || closing) return;
    setClosing(true);
    setShowModal(false);
    closeTimerRef.current = window.setTimeout(onClose, TRANSITION_MS);
  }, [busy, closing, onClose]);

                                                
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [requestClose]);

  const activeFields = useMemo(
    () => credentialFields(installation, localize),
    [installation, localize],
  );

  const valuesComplete = activeFields.length > 0
    ? activeFields.every((field) =>
        String(credentialValues[field.key] ?? '').trim().length > 0,
      )
    : Object.keys(parseCredentialLines(credentialRawText)).length > 0;

  const handleSave = useCallback(async () => {
    const values = activeFields.length > 0
      ? Object.fromEntries(
          activeFields.map((field) => [
            field.key,
            String(credentialValues[field.key] ?? '').trim(),
          ]),
        )
      : parseCredentialLines(credentialRawText);
    await onSave(values);
  }, [activeFields, credentialValues, credentialRawText, onSave]);

                                               
  const title = useMemo(() => {
    if (installation.availability === 'local_setup') {
      return localize('mcp.credential.setupTitle', { name: installation.displayName });
    }
    if (installation.credential) {
      return localize('mcp.credential.updateTitle', { name: installation.displayName });
    }
    return localize('mcp.credential.configureTitle', { name: installation.displayName });
  }, [installation, localize]);

                                               
  const inputClass = `
    mt-2 h-10 w-full rounded-[10px] border-[0.5px] px-[10px] text-[11px] outline-none
    transition-colors
    ${
      'border-edge-soft bg-surface-soft text-theme-primary placeholder:text-[#999999]    dark:placeholder:text-[#555555]'
    }
  `;

  const textareaClass = `
    mt-2 w-full rounded-[10px] border-[0.5px] p-[12px] font-mono text-[11px] outline-none resize-none
    transition-colors
    ${
      'border-edge-soft bg-surface-soft text-theme-primary placeholder:text-[#999999]    dark:placeholder:text-[#555555]'
    }
  `;

                                               
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
          aria-labelledby="mcp-credential-dialog-title"
          className={`
            pointer-events-auto relative flex overflow-hidden rounded-[14px] border-[0.5px] shadow-2xl
            ${'border-edge-strong bg-surface-raised text-theme-primary   '}
          `}
          style={{
            width: 560,
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
              <div className="select-none min-w-0">
                <div
                  id="mcp-credential-dialog-title"
                  className="text-[15px] font-semibold truncate"
                >
                  {title}
                </div>
              </div>
              <button
                type="button"
                onClick={requestClose}
                disabled={busy || closing}
                className={`
                  ml-[12px] shrink-0 select-none rounded-[7px] border-0 px-[8px] py-[5px] text-[10px] outline-none
                  transition-colors disabled:cursor-not-allowed disabled:opacity-40
                  ${'hover:bg-surface-hover-strong '}
                `}
              >
                {localize('common.actions.close')}
              </button>
            </header>

            {                                           }
            <div className="min-h-0 flex-1 overflow-y-auto px-[14px] py-[16px]">
              {            }
              <div
                className={`
                  rounded-[10px] border-[0.5px] px-[12px] py-[10px]
                  ${'border-edge-soft bg-[#f7f7f7]  dark:bg-[#181818]'}
                `}
              >
                <div className="flex items-start gap-[8px]">
                  <svg
                    className={`mt-[2px] h-[13px] w-[13px] shrink-0 ${'text-[#4a7cf7] dark:text-[#8ab4f8]'}`}
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M7.5 4.5h1v1h-1zM7.5 7.5h1v4h-1z" />
                  </svg>
                  <div>
                    <p className="text-[11px] leading-[18px] font-medium">
                      {configurationHint}
                    </p>
                    <p className="mt-[6px] text-[9px] leading-[16px] opacity-50">
                      {localize('mcp.credential.storageHint')}
                    </p>
                  </div>
                </div>
              </div>

              {          }
              {error && (
                <div className="mt-[12px] rounded-[9px] bg-red-500/10 px-[10px] py-[8px] text-[10px] text-red-500">
                  {error}
                </div>
              )}

              {           }
              {activeFields.length > 0 ? (
                <div className="mt-[16px] max-h-[340px] space-y-[14px] overflow-y-auto pr-[2px]">
                  {activeFields.map((field) => (
                    <label key={field.key} className="block">
                      <div className="flex items-center justify-between gap-[8px]">
                        <span className="text-[11px] font-medium">{field.label}</span>
                        <code className={`shrink-0 text-[8px] ${'text-[#000000]/30 dark:text-[#ffffff]/30'}`}>
                          {field.key}
                        </code>
                      </div>
                      <p className={`mt-[3px] text-[9px] leading-[16px] ${'text-theme-balanced-40 '}`}>
                        {field.description}
                      </p>
                      <input
                        type={field.sensitive ? 'password' : 'text'}
                        autoComplete="off"
                        value={credentialValues[field.key] ?? ''}
                        onChange={(event) =>
                          setCredentialValues((current) => ({
                            ...current,
                            [field.key]: event.target.value,
                          }))
                        }
                        className={inputClass}
                        placeholder={field.placeholder}
                      />
                    </label>
                  ))}
                </div>
              ) : (
                          
                <div className="mt-[16px]">
                  <p className={`text-[9px] leading-[16px] ${'text-theme-balanced-40 '}`}>
                    {localize('mcp.credential.freeformHintBefore')} <code className="text-[10px]">KEY=VALUE</code> {localize('mcp.credential.freeformHintAfter')}
                  </p>
                  <textarea
                    value={credentialRawText}
                    onChange={(event) => setCredentialRawText(event.target.value)}
                    className={`${textareaClass} h-[180px]`}
                    placeholder={'API_KEY=sk-…\nENDPOINT=https://…'}
                  />
                </div>
              )}
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
                disabled={!valuesComplete || busy}
                onClick={handleSave}
                className="
                  select-none rounded-[7px] border-0 bg-action-primary px-[12px] py-[6px]
                  text-[10px] text-[#ffffff] outline-none transition-opacity
                  hover:text-[#ffffff] disabled:cursor-not-allowed disabled:opacity-40
                "
              >
                {busy ? localize('common.saving') : localize('mcp.credential.save')}
              </button>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalNode, portalContainer);
}
