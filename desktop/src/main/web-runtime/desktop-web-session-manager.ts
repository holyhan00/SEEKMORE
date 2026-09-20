import { BrowserWindow, session as electronSession } from 'electron';
import type { BrowserWindowConstructorOptions, Session } from 'electron';
import { randomUUID } from 'node:crypto';
import type { DesktopWebSessionMode, DesktopWebSessionRecord } from './desktop-web-runtime.types';
import { DesktopWebNetworkPolicy } from './web-network-policy';

const REF_ATTRIBUTE = 'data-seekmore-runtime-ref';

type ManagedSession = DesktopWebSessionRecord & {
  window: BrowserWindow;
  electronSession: Session;
  snapshotVersion: number;
};

export class DesktopWebSessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly configuredSessions = new WeakSet<Session>();
  private readonly networkPolicy = new DesktopWebNetworkPolicy();

  create(input: {
    mode: DesktopWebSessionMode;
    profileId?: string | null;
    visible?: boolean;
  }): DesktopWebSessionRecord {
    const mode = input.mode;
    if (mode === 'BACKGROUND_SEARCH') {
      const backgroundCount = [...this.sessions.values()]
        .filter((item) => item.mode === 'BACKGROUND_SEARCH')
        .length;
      if (backgroundCount >= 4) {
        throw Object.assign(new Error('Background web session capacity is exhausted.'), {
          code: 'DESKTOP_WEB_BACKGROUND_CAPACITY',
        });
      }
    }
    const sessionId = randomUUID();
    const profileId = this.profileId(input.profileId);
    const visible = mode === 'INTERACTIVE_BROWSER' && input.visible !== false;
    const partition = mode === 'BACKGROUND_SEARCH'
      ? `seekmore-background-${sessionId}`
      : `persist:seekmore-browser-${profileId ?? 'default'}`;
    const ses = electronSession.fromPartition(partition, { cache: mode !== 'BACKGROUND_SEARCH' });
    this.configureSession(ses, mode);

    const window = new BrowserWindow(this.windowOptions({ mode, visible, electronSession: ses }));
    const now = new Date().toISOString();
    const record: ManagedSession = {
      sessionId,
      mode,
      profileId,
      visible,
      createdAt: now,
      updatedAt: now,
      window,
      electronSession: ses,
      snapshotVersion: 0,
    };

    this.sessions.set(sessionId, record);
    this.configureWindow(record);
    return this.publicRecord(record);
  }

  async navigate(input: { sessionId: string; url: string; timeoutMs?: number }): Promise<Record<string, unknown>> {
    const managed = this.require(input.sessionId);
    const mode = managed.mode === 'BACKGROUND_SEARCH' ? 'background' : 'interactive';
    const url = await this.networkPolicy.assertAllowed(input.url, mode);
    await this.withTimeout(managed.window.loadURL(url.toString()), input.timeoutMs ?? 15_000, 'WEB_NAVIGATION_TIMEOUT');
    managed.updatedAt = new Date().toISOString();
    return this.snapshot({ sessionId: input.sessionId });
  }

  async snapshot(input: { sessionId: string }): Promise<Record<string, unknown>> {
    const managed = this.require(input.sessionId);
    managed.snapshotVersion += 1;
    const snapshotId = `${managed.sessionId}:${managed.snapshotVersion}`;
    const data = await managed.window.webContents.executeJavaScript(
      `(${snapshotScript.toString()})(${JSON.stringify({ refAttribute: REF_ATTRIBUTE, snapshotId })})`,
      true,
    );
    managed.updatedAt = new Date().toISOString();
    return this.normalizeSnapshot(data, snapshotId);
  }

  async act(input: {
    sessionId: string;
    action: string;
    target?: Record<string, unknown> | null;
    value?: unknown;
    metadata?: Record<string, unknown> | null;
  }): Promise<Record<string, unknown>> {
    const managed = this.require(input.sessionId);
    const action = String(input.action ?? '').trim().toLowerCase();
    if (action === 'wait') {
      const ms = Math.min(10_000, Math.max(0, Number(input.value ?? 1_000)));
      await new Promise((resolve) => setTimeout(resolve, ms));
      return this.snapshot({ sessionId: input.sessionId });
    }
    if (action === 'open') {
      const targetUrl = String(input.target?.url ?? input.value ?? '').trim();
      return this.navigate({ sessionId: input.sessionId, url: targetUrl });
    }
    if (action === 'snapshot' || action === 'observe') return this.snapshot({ sessionId: input.sessionId });
    if (action === 'screenshot') return this.capture({ sessionId: input.sessionId });

    if (action === 'click' || action === 'hover') {
      const point = await managed.window.webContents.executeJavaScript(
        `(${targetPointScript.toString()})(${JSON.stringify({
          target: input.target ?? {},
          refAttribute: REF_ATTRIBUTE,
        })})`,
        true,
      ) as { ok?: boolean; x?: number; y?: number; code?: string; message?: string };
      if (!point?.ok || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw Object.assign(new Error(String(point?.message ?? 'Target element was not found.')), {
          code: String(point?.code ?? 'ELECTRON_BROWSER_TARGET_NOT_FOUND'),
          detail: point ?? null,
        });
      }
      managed.window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(point.x!), y: Math.round(point.y!) });
      if (action === 'click') {
        managed.window.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(point.x!), y: Math.round(point.y!), button: 'left', clickCount: 1 });
        managed.window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(point.x!), y: Math.round(point.y!), button: 'left', clickCount: 1 });
      }
      await new Promise((resolve) => setTimeout(resolve, 180));
      return this.snapshot({ sessionId: input.sessionId });
    }

    if (action === 'press') {
      await managed.window.webContents.executeJavaScript(
        `(${focusTargetScript.toString()})(${JSON.stringify({
          target: input.target ?? {},
          refAttribute: REF_ATTRIBUTE,
        })})`,
        true,
      );
      const keyCode = String(input.value ?? 'Enter');
      managed.window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      managed.window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
      await new Promise((resolve) => setTimeout(resolve, 220));
      return this.snapshot({ sessionId: input.sessionId });
    }

    const result = await managed.window.webContents.executeJavaScript(
      `(${actionScript.toString()})(${JSON.stringify({
        action,
        target: input.target ?? {},
        value: input.value ?? null,
        refAttribute: REF_ATTRIBUTE,
      })})`,
      true,
    );
    if (!result || result.ok !== true) {
      const error = Object.assign(new Error(String(result?.message ?? `Electron browser action failed: ${action}`)), {
        code: String(result?.code ?? 'ELECTRON_BROWSER_ACTION_FAILED'),
        detail: result ?? null,
      });
      throw error;
    }
    managed.updatedAt = new Date().toISOString();
    return this.snapshot({ sessionId: input.sessionId });
  }

  async getContent(input: { sessionId: string }): Promise<Record<string, unknown>> {
    const managed = this.require(input.sessionId);
    const content = await managed.window.webContents.executeJavaScript(
      `(() => ({ url: location.href, title: document.title, html: document.documentElement?.outerHTML ?? '', text: document.body?.innerText ?? '' }))()`,
      true,
    );
    return {
      ...content,
      fetchedAt: new Date().toISOString(),
    };
  }

  async capture(input: { sessionId: string }): Promise<Record<string, unknown>> {
    const managed = this.require(input.sessionId);
    const image = await managed.window.webContents.capturePage();
    return {
      mimeType: 'image/png',
      data: image.toPNG().toString('base64'),
      url: managed.window.webContents.getURL() || null,
      title: managed.window.getTitle() || null,
    };
  }

  close(sessionId: string): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    this.sessions.delete(sessionId);
    if (!managed.window.isDestroyed()) managed.window.destroy();
    if (managed.mode === 'BACKGROUND_SEARCH') {
      void managed.electronSession.clearStorageData().catch(() => undefined);
      void managed.electronSession.clearCache().catch(() => undefined);
    }
  }

  closeAll(): void {
    for (const sessionId of [...this.sessions.keys()]) this.close(sessionId);
  }

  health(): Record<string, unknown> {
    return {
      status: 'ready',
      sessionCount: this.sessions.size,
      backgroundSessionCount: [...this.sessions.values()].filter((item) => item.mode === 'BACKGROUND_SEARCH').length,
      interactiveSessionCount: [...this.sessions.values()].filter((item) => item.mode === 'INTERACTIVE_BROWSER').length,
      pid: process.pid,
    };
  }

  private configureWindow(managed: ManagedSession): void {
    const mode = managed.mode === 'BACKGROUND_SEARCH' ? 'background' : 'interactive';
    managed.window.webContents.setWindowOpenHandler((details) => {
      if (!this.networkPolicy.isAllowedNavigation(details.url, mode)) return { action: 'deny' };
      void managed.window.loadURL(details.url).catch(() => undefined);
      return { action: 'deny' };
    });
    managed.window.webContents.on('will-navigate', (event, targetUrl) => {
      if (!this.networkPolicy.isAllowedNavigation(targetUrl, mode)) event.preventDefault();
    });
    managed.window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    managed.window.on('closed', () => this.sessions.delete(managed.sessionId));
    if (managed.visible) {
      managed.window.once('ready-to-show', () => {
        if (!managed.window.isDestroyed()) {
          managed.window.show();
          managed.window.focus();
        }
      });
    }
  }

  private configureSession(ses: Session, mode: DesktopWebSessionMode): void {
    if (this.configuredSessions.has(ses)) return;
    this.configuredSessions.add(ses);
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (event) => event.preventDefault());
    if (mode === 'BACKGROUND_SEARCH') {
      ses.webRequest.onBeforeRequest((details, callback) => {
        if (['image', 'media', 'font', 'object', 'ping'].includes(details.resourceType)) {
          callback({ cancel: true });
          return;
        }
        void this.networkPolicy.assertAllowed(details.url, 'background')
          .then(() => callback({ cancel: false }))
          .catch(() => callback({ cancel: true }));
      });
    }
  }

  private windowOptions(input: { mode: DesktopWebSessionMode; visible: boolean; electronSession: Session }): BrowserWindowConstructorOptions {
    return {
      title: input.mode === 'BACKGROUND_SEARCH' ? 'Seekmore Background Web Runtime' : '超体浏览器',
      width: 1180,
      height: 820,
      minWidth: 860,
      minHeight: 600,
      show: false,
      skipTaskbar: input.mode === 'BACKGROUND_SEARCH',
      backgroundColor: '#ffffff',
      webPreferences: {
        session: input.electronSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        autoplayPolicy: 'document-user-activation-required',
      },
    };
  }

  private require(sessionId: string): ManagedSession {
    const managed = this.sessions.get(String(sessionId ?? '').trim());
    if (!managed || managed.window.isDestroyed()) {
      throw Object.assign(new Error('Desktop web session not found.'), { code: 'DESKTOP_WEB_SESSION_NOT_FOUND' });
    }
    return managed;
  }

  private normalizeSnapshot(value: unknown, snapshotId: string): Record<string, unknown> {
    const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const text = String(record.text ?? '').slice(0, 40_000);
    return {
      url: String(record.url ?? '') || null,
      title: String(record.title ?? '') || null,
      text,
      rawText: text,
      compactText: text.slice(0, 8_000),
      interactiveElements: Array.isArray(record.interactiveElements) ? record.interactiveElements.slice(0, 300) : [],
      snapshotId,
    };
  }

  private publicRecord(record: ManagedSession): DesktopWebSessionRecord {
    return {
      sessionId: record.sessionId,
      mode: record.mode,
      profileId: record.profileId,
      visible: record.visible,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private clean(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
  }

  private profileId(value: unknown): string | null {
    const cleaned = this.clean(value);
    if (!cleaned) return null;
    const normalized = cleaned.normalize('NFKC').replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
    return normalized.slice(0, 80) || null;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('Desktop web operation timed out.'), { code })), Math.max(1_000, timeoutMs));
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function snapshotScript(input: { refAttribute: string; snapshotId: string }) {
  const selector = [
    'a[href]', 'button', 'input', 'textarea', 'select', 'summary',
    '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="searchbox"]',
    '[role="combobox"]', '[role="menuitem"]', '[role="tab"]', '[contenteditable="true"]',
  ].join(',');
  const elements = Array.from(document.querySelectorAll(selector)).filter((element) => {
    const node = element as HTMLElement;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  });
  const interactiveElements = elements.slice(0, 300).map((element, index) => {
    const node = element as HTMLElement;
    const ref = `${input.snapshotId}:${index + 1}`;
    node.setAttribute(input.refAttribute, ref);
    const tag = node.tagName.toLowerCase();
    const explicitRole = node.getAttribute('role');
    const role = explicitRole || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag === 'select' ? 'combobox' : tag === 'textarea' ? 'textbox' : tag === 'input' ? ((node as HTMLInputElement).type === 'search' ? 'searchbox' : 'textbox') : node.isContentEditable ? 'textbox' : 'element');
    const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    const name = node.getAttribute('aria-label') || node.getAttribute('title') || node.getAttribute('placeholder') || text || (node as HTMLInputElement).name || '';
    const href = tag === 'a' ? (node as HTMLAnchorElement).href : null;
    const rect = node.getBoundingClientRect();
    return {
      ref,
      role,
      name: String(name).slice(0, 240),
      text: text.slice(0, 500),
      target: `[${input.refAttribute}="${ref}"]`,
      selector: `[${input.refAttribute}="${ref}"]`,
      href,
      nth: index,
      editable: tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable,
      disabled: Boolean((node as HTMLInputElement).disabled) || node.getAttribute('aria-disabled') === 'true',
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
  return {
    url: location.href,
    title: document.title,
    text: (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 40_000),
    interactiveElements,
  };
}


function targetPointScript(input: { target: Record<string, unknown>; refAttribute: string }) {
  const target = input.target || {};
  const all = Array.from(document.querySelectorAll<HTMLElement>('*'));
  let element: HTMLElement | null = null;
  const ref = String(target.ref || '').trim();
  const selector = String(target.selector || '').trim();
  if (ref) element = document.querySelector<HTMLElement>(`[${input.refAttribute}="${CSS.escape(ref)}"]`);
  if (!element && selector) {
    try { element = document.querySelector<HTMLElement>(selector); } catch { element = null; }
  }
  if (!element) {
    const role = String(target.role || '').trim().toLowerCase();
    const name = String(target.name || target.label || target.title || '').trim().toLowerCase();
    const text = String(target.text || '').trim().toLowerCase();
    const candidates = all.filter((node) => {
      const nodeRole = String(node.getAttribute('role') || '').toLowerCase();
      const nodeText = String(node.getAttribute('aria-label') || node.getAttribute('title') || node.getAttribute('placeholder') || node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return (!role || nodeRole === role || (role === 'button' && node.tagName === 'BUTTON') || (role === 'link' && node.tagName === 'A')) && (!name || nodeText.includes(name)) && (!text || nodeText.includes(text));
    });
    const index = Number.isFinite(Number(target.index)) ? Number(target.index) : 0;
    element = candidates[Math.max(0, index)] ?? null;
  }
  if (!element) return { ok: false, code: 'ELECTRON_BROWSER_TARGET_NOT_FOUND', message: 'Target element was not found.' };
  element.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = element.getBoundingClientRect();
  return { ok: rect.width > 0 && rect.height > 0, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function focusTargetScript(input: { target: Record<string, unknown>; refAttribute: string }) {
  const target = input.target || {};
  const hasTarget = Object.keys(target).some((key) => String(target[key] ?? '').trim());
  let element: HTMLElement | null = null;
  if (hasTarget) {
    const ref = String(target.ref || '').trim();
    const selector = String(target.selector || '').trim();
    if (ref) element = document.querySelector<HTMLElement>(`[${input.refAttribute}="${CSS.escape(ref)}"]`);
    if (!element && selector) {
      try { element = document.querySelector<HTMLElement>(selector); } catch { element = null; }
    }
  } else {
    element = document.activeElement as HTMLElement | null;
  }
  element?.focus?.();
  return { ok: true };
}

function actionScript(input: { action: string; target: Record<string, unknown>; value: unknown; refAttribute: string }) {
  const target = input.target || {};
  const all = Array.from(document.querySelectorAll<HTMLElement>('*'));
  let element: HTMLElement | null = null;
  const ref = String(target.ref || '').trim();
  const selector = String(target.selector || '').trim();
  if (ref) element = document.querySelector<HTMLElement>(`[${input.refAttribute}="${CSS.escape(ref)}"]`);
  if (!element && selector) {
    try { element = document.querySelector<HTMLElement>(selector); } catch { element = null; }
  }
  if (!element) {
    const role = String(target.role || '').trim().toLowerCase();
    const name = String(target.name || target.label || target.title || '').trim().toLowerCase();
    const text = String(target.text || '').trim().toLowerCase();
    const candidates = all.filter((node) => {
      const nodeRole = String(node.getAttribute('role') || '').toLowerCase();
      const nodeText = String(node.getAttribute('aria-label') || node.getAttribute('title') || node.getAttribute('placeholder') || node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return (!role || nodeRole === role || (role === 'button' && node.tagName === 'BUTTON') || (role === 'link' && node.tagName === 'A')) && (!name || nodeText.includes(name)) && (!text || nodeText.includes(text));
    });
    const index = Number.isFinite(Number(target.index)) ? Number(target.index) : 0;
    element = candidates[Math.max(0, index)] ?? null;
  }
  if (!element && input.action !== 'press') return { ok: false, code: 'ELECTRON_BROWSER_TARGET_NOT_FOUND', message: 'Target element was not found.' };

  if (input.action === 'click') {
    element!.scrollIntoView({ block: 'center', inline: 'center' });
    element!.click();
  } else if (input.action === 'hover') {
    element!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    element!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  } else if (input.action === 'fill') {
    const value = String(input.value ?? '');
    const node = element as HTMLElement;
    node.focus();
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      const prototype = node instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(node, value); else node.value = value;
    } else node.textContent = value;
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (input.action === 'select') {
    const node = element as HTMLSelectElement;
    const values = Array.isArray(input.value) ? input.value.map(String) : [String(input.value ?? '')];
    Array.from(node.options).forEach((option) => { option.selected = values.includes(option.value) || values.includes(option.text); });
    node.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (input.action === 'press') {
    const key = String(input.value ?? 'Enter');
    const node = element || document.activeElement || document.body;
    node.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true }));
    if (key === 'Enter' && node instanceof HTMLInputElement && node.form) node.form.requestSubmit();
  } else {
    return { ok: false, code: 'ELECTRON_BROWSER_ACTION_UNSUPPORTED', message: `Unsupported action: ${input.action}` };
  }
  return { ok: true };
}
