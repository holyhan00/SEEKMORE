import { app } from 'electron';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { access, chmod, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createConnection } from 'node:net';
import type { Readable } from 'node:stream';
import path from 'node:path';
import { resolveSeekmoreDataHome } from '../../../seekmore-data-home';
import type {
  DesktopMcpSetup,
  DesktopMcpSetupAdapter,
  DesktopMcpSetupContext,
  DesktopMcpSetupError,
  DesktopMcpSetupResult,
} from '../../setup/desktop-mcp-setup.types';

export type BlenderAddonDesktopSetup = DesktopMcpSetup & {
  kind: 'BLENDER_ADDON';
  releaseKey: string;
  applicationId: 'org.blenderfoundation.blender';
  executableEnvironmentVariable: 'SEEKMORE_BLENDER_EXECUTABLE';
  supportedBlenderVersion: {
    minimum: string;
    maximumExclusive?: string;
  };
  addon: {
    moduleName: string;
    downloadUrl: string;
    expectedSha256?: string;
    maximumBytes: number;
    autoUpdate: false;
  };
  readiness: {
    host: '127.0.0.1';
    port: number;
  };
  setupTimeoutMs: number;
};

const MAX_PROCESS_OUTPUT = 32_768;
const ALLOWED_ADDON_HOST = 'raw.githubusercontent.com';
type BlenderProcess = ChildProcessByStdio<null, Readable, Readable>;

export class BlenderAddonSetupAdapter
  implements DesktopMcpSetupAdapter<BlenderAddonDesktopSetup> {
  readonly kind = 'BLENDER_ADDON';

  validate(value: unknown): BlenderAddonDesktopSetup {
    const row = this.record(value);
    if (row.kind !== this.kind) {
      throw this.error(
        'MCP_DESKTOP_SETUP_UNSUPPORTED',
        'Unsupported Desktop MCP setup adapter.',
      );
    }
    const addon = this.record(row.addon);
    const readiness = this.record(row.readiness);
    const supportedVersion = this.record(row.supportedBlenderVersion);
    const releaseKey = this.required(
      row.releaseKey,
      'MCP_DESKTOP_SETUP_RELEASE_INVALID',
      200,
    );
    const moduleName = this.required(
      addon.moduleName,
      'MCP_DESKTOP_SETUP_MODULE_INVALID',
      200,
    );
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(moduleName)) {
      throw this.error(
        'MCP_DESKTOP_SETUP_MODULE_INVALID',
        'Invalid Blender Add-on module name.',
      );
    }
    const downloadUrl = new URL(
      this.required(
        addon.downloadUrl,
        'MCP_DESKTOP_SETUP_SOURCE_INVALID',
        4_096,
      ),
    );
    if (
      downloadUrl.protocol !== 'https:' ||
      downloadUrl.hostname !== ALLOWED_ADDON_HOST ||
      !/^\/ahujasid\/blender-mcp\/[a-f0-9]{40}\/addon\.py$/.test(
        downloadUrl.pathname,
      )
    ) {
      throw this.error(
        'MCP_DESKTOP_SETUP_SOURCE_INVALID',
        'The Blender Add-on source is not approved.',
      );
    }
    const expectedSha256 = String(addon.expectedSha256 ?? '')
      .trim()
      .toLowerCase();
    if (expectedSha256 && !/^[a-f0-9]{64}$/.test(expectedSha256)) {
      throw this.error(
        'MCP_DESKTOP_SETUP_HASH_INVALID',
        'Invalid Blender Add-on hash.',
      );
    }
    const maximumBytes = Number(addon.maximumBytes);
    const port = Number(readiness.port);
    if (
      !Number.isInteger(maximumBytes) ||
      maximumBytes < 1_024 ||
      maximumBytes > 2_000_000
    ) {
      throw this.error(
        'MCP_DESKTOP_SETUP_SIZE_INVALID',
        'Invalid Blender Add-on size limit.',
      );
    }
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw this.error(
        'MCP_DESKTOP_SETUP_PORT_INVALID',
        'Invalid Blender MCP readiness port.',
      );
    }
    return {
      kind: this.kind,
      releaseKey,
      applicationId: 'org.blenderfoundation.blender',
      executableEnvironmentVariable: 'SEEKMORE_BLENDER_EXECUTABLE',
      supportedBlenderVersion: {
        minimum: this.required(
          supportedVersion.minimum,
          'MCP_DESKTOP_SETUP_VERSION_INVALID',
          40,
        ),
        ...(supportedVersion.maximumExclusive
          ? {
              maximumExclusive: this.required(
                supportedVersion.maximumExclusive,
                'MCP_DESKTOP_SETUP_VERSION_INVALID',
                40,
              ),
            }
          : {}),
      },
      addon: {
        moduleName,
        downloadUrl: downloadUrl.toString(),
        ...(expectedSha256 ? { expectedSha256 } : {}),
        maximumBytes,
        autoUpdate: false,
      },
      readiness: { host: '127.0.0.1', port },
      setupTimeoutMs: this.timeout(row.setupTimeoutMs),
    };
  }
  async prepare(
    setup: BlenderAddonDesktopSetup,
    context: DesktopMcpSetupContext,
  ): Promise<DesktopMcpSetupResult> {
    const startedAt = Date.now();
    const executable = await this.resolveBlenderExecutable(setup);
    const version = await this.readBlenderVersion(executable);
    this.assertSupportedVersion(version, setup);

    context.log('desktop.mcp.blender_detected', {
      installationId: context.installationId,
      applicationPath: executable,
      applicationVersion: version,
    });

    const releaseDirectory = path.join(
      resolveSeekmoreDataHome(app),
      'mcp-integrations',
      'blender',
      this.safeSegment(setup.releaseKey),
    );
    await mkdir(releaseDirectory, { recursive: true, mode: 0o700 });

    const trustedRelease = await this.readTrustedRelease(
      setup,
      releaseDirectory,
    );
    const portReady = await this.isPortReady(
      setup.readiness.host,
      setup.readiness.port,
      800,
    );
    if (portReady && trustedRelease) {
      context.log('desktop.mcp.blender_trusted_release_ready', {
        installationId: context.installationId,
        releaseKey: setup.releaseKey,
        addonSha256: trustedRelease.addonSha256,
      });
      return {
        kind: setup.kind,
        ready: true,
        installed: true,
        launched: false,
        applicationPath: executable,
        applicationVersion: version,
        releaseKey: setup.releaseKey,
        addonSha256: trustedRelease.addonSha256,
      };
    }
    if (portReady) {
      throw this.error(
        'BLENDER_EXISTING_SERVER_UNVERIFIED',
        'An unverified Blender MCP service is already using the configured port. Close Blender or stop the existing service, then retry.',
        {
          host: setup.readiness.host,
          port: setup.readiness.port,
          releaseKey: setup.releaseKey,
        },
      );
    }

    const addon = await this.ensureAddon(setup, releaseDirectory, context);
    const bootstrapScript = path.join(releaseDirectory, 'seek-more-install-addon.py');
    await writeFile(
      bootstrapScript,
      this.bootstrapScript(addon.path, setup.addon.moduleName, setup.readiness.port),
      { encoding: 'utf8', mode: 0o600 },
    );
    await chmod(bootstrapScript, 0o600).catch(() => undefined);

    context.log('desktop.mcp.blender_launching', {
      installationId: context.installationId,
      applicationPath: executable,
      releaseKey: setup.releaseKey,
      addonSha256: addon.sha256,
    });

    const process = spawn(executable, ['--python', bootstrapScript], {
      shell: false,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: this.minimalEnvironment(),
    });
    const diagnostic = this.captureProcessOutput(process);

    try {
      await this.waitForReadiness(
        process,
        setup.readiness.host,
        setup.readiness.port,
        setup.setupTimeoutMs,
        diagnostic,
      );
    } catch (error) {
      const normalized = this.asError(
        error,
        'BLENDER_SOCKET_NOT_READY',
        'Blender opened, but the Blender MCP Add-on did not become ready.',
        {
          stage: 'blender_setup',
          applicationPath: executable,
          applicationVersion: version,
          releaseKey: setup.releaseKey,
          stdoutSummary: this.summary(diagnostic.stdout),
          stderrSummary: this.summary(diagnostic.stderr),
          durationMs: Date.now() - startedAt,
        },
      );
      context.warn('desktop.mcp.blender_setup_failed', {
        installationId: context.installationId,
        code: normalized.code,
        error: normalized.message,
        detail: normalized.detail,
      });
      throw normalized;
    }

    await this.writeTrustedRelease(
      setup,
      releaseDirectory,
      addon.sha256,
      executable,
      version,
    );

    context.log('desktop.mcp.blender_ready', {
      installationId: context.installationId,
      applicationPath: executable,
      applicationVersion: version,
      releaseKey: setup.releaseKey,
      addonSha256: addon.sha256,
      durationMs: Date.now() - startedAt,
    });

    return {
      kind: setup.kind,
      ready: true,
      installed: true,
      launched: true,
      applicationPath: executable,
      applicationVersion: version,
      releaseKey: setup.releaseKey,
      addonSha256: addon.sha256,
    };
  }

  private async readTrustedRelease(
    setup: BlenderAddonDesktopSetup,
    releaseDirectory: string,
  ): Promise<{ addonSha256: string } | null> {
    try {
      const marker = JSON.parse(
        await readFile(path.join(releaseDirectory, 'installed-release.json'), 'utf8'),
      ) as Record<string, unknown>;
      const addonSha256 = String(marker.addonSha256 ?? '').trim().toLowerCase();
      if (
        marker.releaseKey !== setup.releaseKey ||
        marker.downloadUrl !== setup.addon.downloadUrl ||
        marker.moduleName !== setup.addon.moduleName ||
        !/^[a-f0-9]{64}$/.test(addonSha256) ||
        (setup.addon.expectedSha256 && setup.addon.expectedSha256 !== addonSha256)
      ) {
        return null;
      }
      return { addonSha256 };
    } catch {
      return null;
    }
  }

  private async writeTrustedRelease(
    setup: BlenderAddonDesktopSetup,
    releaseDirectory: string,
    addonSha256: string,
    applicationPath: string,
    applicationVersion: string | null,
  ): Promise<void> {
    await writeFile(
      path.join(releaseDirectory, 'installed-release.json'),
      JSON.stringify(
        {
          releaseKey: setup.releaseKey,
          downloadUrl: setup.addon.downloadUrl,
          moduleName: setup.addon.moduleName,
          addonSha256,
          applicationPath,
          applicationVersion,
          installedAt: new Date().toISOString(),
          autoUpdate: false,
        },
        null,
        2,
      ),
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  private async ensureAddon(
    setup: BlenderAddonDesktopSetup,
    releaseDirectory: string,
    context: DesktopMcpSetupContext,
  ): Promise<{ path: string; sha256: string }> {
    const addonPath = path.join(releaseDirectory, `${setup.addon.moduleName}.py`);
    const metadataPath = path.join(releaseDirectory, 'release.json');

    try {
      const [content, metadataText] = await Promise.all([
        readFile(addonPath),
        readFile(metadataPath, 'utf8'),
      ]);
      const metadata = JSON.parse(metadataText) as {
        releaseKey?: string;
        sha256?: string;
        downloadUrl?: string;
      };
      const sha256 = this.hash(content);
      if (
        metadata.releaseKey === setup.releaseKey &&
        metadata.sha256 === sha256 &&
        metadata.downloadUrl === setup.addon.downloadUrl &&
        (!setup.addon.expectedSha256 || setup.addon.expectedSha256 === sha256)
      ) {
        context.log('desktop.mcp.blender_addon_cached', {
          installationId: context.installationId,
          releaseKey: setup.releaseKey,
          addonSha256: sha256,
        });
        return { path: addonPath, sha256 };
      }
    } catch {
                                                                              
    }

    context.log('desktop.mcp.blender_addon_downloading', {
      installationId: context.installationId,
      releaseKey: setup.releaseKey,
      sourceHost: ALLOWED_ADDON_HOST,
    });

    const content = await this.downloadAddon(setup);
    const sha256 = this.hash(content);
    if (setup.addon.expectedSha256 && setup.addon.expectedSha256 !== sha256) {
      throw this.error(
        'BLENDER_ADDON_HASH_MISMATCH',
        'The downloaded Blender MCP Add-on failed integrity verification.',
        { expectedSha256: setup.addon.expectedSha256, actualSha256: sha256 },
      );
    }

    const temporaryPath = `${addonPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, content, { mode: 0o600 });
    await rename(temporaryPath, addonPath);
    await chmod(addonPath, 0o600).catch(() => undefined);
    await writeFile(
      metadataPath,
      JSON.stringify(
        {
          releaseKey: setup.releaseKey,
          sha256,
          downloadUrl: setup.addon.downloadUrl,
          downloadedAt: new Date().toISOString(),
          autoUpdate: false,
        },
        null,
        2,
      ),
      { encoding: 'utf8', mode: 0o600 },
    );

    return { path: addonPath, sha256 };
  }

  private async downloadAddon(setup: BlenderAddonDesktopSetup): Promise<Buffer> {
    const source = new URL(setup.addon.downloadUrl);
    if (
      source.protocol !== 'https:' ||
      source.hostname !== ALLOWED_ADDON_HOST ||
      !/^\/ahujasid\/blender-mcp\/[a-f0-9]{40}\/addon\.py$/.test(
        source.pathname,
      )
    ) {
      throw this.error('BLENDER_ADDON_SOURCE_DENIED', 'The Blender Add-on source is not approved.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    timer.unref?.();
    try {
      const response = await fetch(source, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': `SeekMore/${app.getVersion()}` },
      });
      const finalUrl = new URL(response.url || source.toString());
      if (
        !response.ok ||
        finalUrl.protocol !== 'https:' ||
        finalUrl.hostname !== ALLOWED_ADDON_HOST ||
        finalUrl.pathname !== source.pathname
      ) {
        throw this.error(
          'BLENDER_ADDON_DOWNLOAD_FAILED',
          `Unable to download the Blender MCP Add-on (${response.status}).`,
        );
      }
      const declaredLength = Number(response.headers.get('content-length') ?? 0);
      if (declaredLength > setup.addon.maximumBytes) {
        throw this.error('BLENDER_ADDON_TOO_LARGE', 'The Blender MCP Add-on exceeds the allowed size.');
      }
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length < 1_024 || body.length > setup.addon.maximumBytes) {
        throw this.error('BLENDER_ADDON_SIZE_INVALID', 'The Blender MCP Add-on has an invalid size.');
      }
      if (!body.toString('utf8', 0, Math.min(body.length, 8_192)).includes('bl_info')) {
        throw this.error('BLENDER_ADDON_CONTENT_INVALID', 'The downloaded file is not a Blender Add-on.');
      }
      return body;
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') {
        throw this.error('BLENDER_ADDON_DOWNLOAD_TIMEOUT', 'Downloading the Blender MCP Add-on timed out.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async resolveBlenderExecutable(
    setup: BlenderAddonDesktopSetup,
  ): Promise<string> {
    const override = String(process.env[setup.executableEnvironmentVariable] ?? '').trim();
    const candidates = override ? [override] : await this.blenderCandidates();
    for (const candidate of candidates) {
      try {
        await access(candidate, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
        return candidate;
      } catch {
                                                            
      }
    }
    throw this.error(
      'BLENDER_NOT_INSTALLED',
      'Blender was not found. Install Blender or set SEEKMORE_BLENDER_EXECUTABLE.',
      { searchedPaths: candidates.slice(0, 20) },
    );
  }

  private async blenderCandidates(): Promise<string[]> {
    if (process.platform === 'darwin') {
      const roots = [
        '/Applications',
        path.join(app.getPath('home'), 'Applications'),
      ];
      const candidates = [
        '/Applications/Blender.app/Contents/MacOS/Blender',
        path.join(app.getPath('home'), 'Applications/Blender.app/Contents/MacOS/Blender'),
      ];
      for (const root of roots) {
        const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (
            entry.isDirectory() &&
            /^Blender(?:[ ._-].*)?\.app$/i.test(entry.name)
          ) {
            candidates.push(
              path.join(root, entry.name, 'Contents', 'MacOS', 'Blender'),
            );
          }
        }
      }
      return [...new Set(candidates)];
    }
    if (process.platform === 'win32') {
      const roots = [
        path.join(String(process.env.ProgramFiles ?? 'C:\\Program Files'), 'Blender Foundation'),
        path.join(String(process.env.LOCALAPPDATA ?? ''), 'Programs', 'Blender Foundation'),
      ].filter(Boolean);
      const candidates: string[] = [];
      for (const root of roots) {
        const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.toLowerCase().startsWith('blender')) {
            candidates.push(path.join(root, entry.name, 'blender.exe'));
          }
        }
      }
      return candidates;
    }
    return ['/usr/local/bin/blender', '/usr/bin/blender', '/snap/bin/blender'];
  }

  private async readBlenderVersion(executable: string): Promise<string | null> {
    const child = spawn(executable, ['--version'], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: this.minimalEnvironment(),
    });
    const output = this.captureProcessOutput(child);
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code));
    }).catch(() => null);
    if (exitCode !== 0) return null;
    const match = `${output.stdout}\n${output.stderr}`.match(/Blender\s+(\d+(?:\.\d+){1,2})/i);
    return match?.[1] ?? null;
  }

  private assertSupportedVersion(
    version: string | null,
    setup: BlenderAddonDesktopSetup,
  ): void {
    if (!version) return;
    if (this.compareVersions(version, setup.supportedBlenderVersion.minimum) < 0) {
      throw this.error('BLENDER_VERSION_UNSUPPORTED', 'The installed Blender version is too old.', {
        installedVersion: version,
        minimumVersion: setup.supportedBlenderVersion.minimum,
      });
    }
    const maximum = setup.supportedBlenderVersion.maximumExclusive;
    if (maximum && this.compareVersions(version, maximum) >= 0) {
      throw this.error('BLENDER_VERSION_UNSUPPORTED', 'The installed Blender version has not been approved yet.', {
        installedVersion: version,
        maximumExclusive: maximum,
      });
    }
  }

  private async waitForReadiness(
    process: BlenderProcess,
    host: string,
    port: number,
    timeoutMs: number,
    diagnostic: { stdout: string; stderr: string },
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const exitState: {
      value: { code: number | null; signal: NodeJS.Signals | null } | null;
    } = { value: null };
    process.once('exit', (code, signal) => {
      exitState.value = { code, signal };
    });
    process.once('error', (error) => {
      diagnostic.stderr = this.append(diagnostic.stderr, error.message);
    });

    while (Date.now() < deadline) {
      if (await this.isPortReady(host, port, 700)) return;
      const exited = exitState.value;
      if (exited) {
        throw this.error('BLENDER_PROCESS_EXITED', 'Blender exited before the MCP Add-on became ready.', {
          exitCode: exited.code,
          signal: exited.signal,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw this.error('BLENDER_SOCKET_NOT_READY', 'Blender did not open the MCP socket before the setup timeout.');
  }

  private isPortReady(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = createConnection({ host, port });
      const finish = (ready: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(ready);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });
  }

  private bootstrapScript(addonPath: string, moduleName: string, port: number): string {
    const encodedPath = JSON.stringify(addonPath);
    const encodedModule = JSON.stringify(moduleName);
    return `import bpy\nimport importlib\nimport os\nimport shutil\nimport traceback\n\nSOURCE = ${encodedPath}\nMODULE = ${encodedModule}\nPORT = ${port}\n\ntry:\n    addon_dir = bpy.utils.user_resource('SCRIPTS', path='addons', create=True)\n    target = os.path.join(addon_dir, MODULE + '.py')\n    if MODULE in bpy.context.preferences.addons:\n        try:\n            bpy.ops.preferences.addon_disable(module=MODULE)\n        except Exception:\n            pass\n    shutil.copy2(SOURCE, target)\n    importlib.invalidate_caches()\n    bpy.ops.preferences.addon_enable(module=MODULE)\n    scene = bpy.context.scene\n    if hasattr(scene, 'blendermcp_port'):\n        scene.blendermcp_port = PORT\n    if hasattr(scene, 'blendermcp_auto_start_server'):\n        scene.blendermcp_auto_start_server = True\n    if hasattr(scene, 'blendermcp_server_running') and not scene.blendermcp_server_running:\n        try:\n            bpy.ops.blendermcp.start_server()\n        except Exception:\n            traceback.print_exc()\n    bpy.ops.wm.save_userpref()\n    print('SEEK_MORE_BLENDER_MCP_READY', flush=True)\nexcept Exception:\n    traceback.print_exc()\n    raise\n`;
  }

  private captureProcessOutput(process: BlenderProcess): { stdout: string; stderr: string } {
    const state = { stdout: '', stderr: '' };
    process.stdout.on('data', (chunk) => {
      state.stdout = this.append(state.stdout, chunk);
    });
    process.stderr.on('data', (chunk) => {
      state.stderr = this.append(state.stderr, chunk);
    });
    return state;
  }

  private minimalEnvironment(): NodeJS.ProcessEnv {
    const keys = process.platform === 'win32'
      ? ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
      : ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER'];
    return Object.fromEntries(
      keys.map((key) => [key, process.env[key]]).filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
  }

  private compareVersions(left: string, right: string): number {
    const a = left.split('.').map((item) => Number.parseInt(item, 10) || 0);
    const b = right.split('.').map((item) => Number.parseInt(item, 10) || 0);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const difference = (a[index] ?? 0) - (b[index] ?? 0);
      if (difference !== 0) return difference > 0 ? 1 : -1;
    }
    return 0;
  }

  private hash(value: Buffer): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private append(current: string, value: unknown): string {
    const next = `${current}${Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '')}`;
    return next.length <= MAX_PROCESS_OUTPUT ? next : next.slice(-MAX_PROCESS_OUTPUT);
  }

  private summary(value: string): string | null {
    const clean = value.replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    return clean.length <= 2_000 ? clean : `${clean.slice(0, 2_000)}...<truncated>`;
  }

  private safeSegment(value: string): string {
    return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'release';
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private required(value: unknown, code: string, maximum: number): string {
    const text = String(value ?? '').trim();
    if (!text || text.length > maximum || /[\0\r\n]/.test(text)) {
      throw this.error(code, 'Invalid Desktop MCP setup value.');
    }
    return text;
  }

  private timeout(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1_000 || parsed > 300_000) {
      throw this.error(
        'MCP_DESKTOP_SETUP_TIMEOUT_INVALID',
        'Invalid Desktop MCP setup timeout.',
      );
    }
    return Math.floor(parsed);
  }

  private asError(
    error: unknown,
    fallbackCode: string,
    fallbackMessage: string,
    detail: Record<string, unknown>,
  ): DesktopMcpSetupError {
    const existing = error as Partial<DesktopMcpSetupError> | null;
    return this.error(
      String(existing?.code ?? '').trim() || fallbackCode,
      error instanceof Error && error.message ? error.message : fallbackMessage,
      { ...(existing?.detail ?? {}), ...detail },
    );
  }

  private error(
    code: string,
    message: string,
    detail?: Record<string, unknown>,
  ): DesktopMcpSetupError {
    return Object.assign(new Error(message), { code, ...(detail ? { detail } : {}) });
  }
}
