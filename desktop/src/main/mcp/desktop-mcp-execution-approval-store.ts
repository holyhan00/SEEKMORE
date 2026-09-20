// desktop/src/main/mcp/desktop-mcp-execution-approval-store.ts
import { app } from 'electron';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveSeekmoreDataHome } from '../seekmore-data-home';

type StoredExecutionApproval = {
  installationId: string;
  executionDigest: string;
  desktopSetupDigest: string | null;
  approvedAt: string;
};

type StoredExecutionApprovalFile = {
  approvals: Record<string, StoredExecutionApproval>;
};

export class DesktopMcpExecutionApprovalStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  async isApproved(
    installationId: string,
    executionDigest: string,
    desktopSetupDigest: string | null,
  ): Promise<boolean> {
    const cleanInstallationId = this.requiredId(installationId);
    const cleanExecutionDigest = this.requiredDigest(executionDigest);
    const cleanDesktopSetupDigest = desktopSetupDigest
      ? this.requiredDigest(desktopSetupDigest)
      : null;

    await this.mutationQueue.catch(() => undefined);

    const file = await this.readStore();
    const approval = file.approvals[cleanInstallationId];

    if (
      !approval
      || approval.installationId !== cleanInstallationId
      || approval.executionDigest !== cleanExecutionDigest
    ) {
      return false;
    }

    if (
      cleanDesktopSetupDigest
      && approval.desktopSetupDigest !== cleanDesktopSetupDigest
    ) {
      return false;
    }

    return true;
  }

  async approve(
    installationId: string,
    executionDigest: string,
    desktopSetupDigest: string | null,
  ): Promise<void> {
    const cleanInstallationId = this.requiredId(installationId);
    const cleanExecutionDigest = this.requiredDigest(executionDigest);
    const cleanDesktopSetupDigest = desktopSetupDigest
      ? this.requiredDigest(desktopSetupDigest)
      : null;

    await this.enqueueMutation(async () => {
      const file = await this.readStore();
      const existing = file.approvals[cleanInstallationId];

      file.approvals[cleanInstallationId] = {
        installationId: cleanInstallationId,
        executionDigest: cleanExecutionDigest,
        desktopSetupDigest:
          cleanDesktopSetupDigest
          ?? (
            existing?.executionDigest === cleanExecutionDigest
              ? existing.desktopSetupDigest
              : null
          ),
        approvedAt: new Date().toISOString(),
      };

      await this.writeStore(file);
    });
  }

  async revoke(installationId: string): Promise<void> {
    const cleanInstallationId = this.requiredId(installationId);

    await this.enqueueMutation(async () => {
      const file = await this.readStore();

      if (!file.approvals[cleanInstallationId]) {
        return;
      }

      delete file.approvals[cleanInstallationId];
      await this.writeStore(file);
    });
  }

  private enqueueMutation(action: () => Promise<void>): Promise<void> {
    const next = this.mutationQueue.then(action, action);
    this.mutationQueue = next.catch(() => undefined);
    return next;
  }

  private async readStore(): Promise<StoredExecutionApprovalFile> {
    try {
      const raw = JSON.parse(
        await readFile(this.filePath(), 'utf8'),
      ) as StoredExecutionApprovalFile;

      if (
        raw?.approvals
        && typeof raw.approvals === 'object'
        && !Array.isArray(raw.approvals)
      ) {
        return {
          approvals: raw.approvals,
        };
      }
    } catch {
    }

    return {
      approvals: {},
    };
  }

  private async writeStore(value: StoredExecutionApprovalFile): Promise<void> {
    const filePath = this.filePath();

    await mkdir(
      path.dirname(filePath),
      {
        recursive: true,
        mode: 0o700,
      },
    );

    const temporary = `${filePath}.${process.pid}.tmp`;

    await writeFile(
      temporary,
      JSON.stringify(value),
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    );

    try {
      await rename(
        temporary,
        filePath,
      );
    } catch (error) {
      if (process.platform !== 'win32') {
        throw error;
      }

      await unlink(filePath).catch(() => undefined);
      await rename(
        temporary,
        filePath,
      );
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private filePath(): string {
    return path.join(
      resolveSeekmoreDataHome(app),
      'mcp',
      'execution-approvals.json',
    );
  }

  private requiredId(value: string): string {
    const id = String(value ?? '').trim();

    if (
      !id
      || id.length > 200
      || /[\r\n\0]/.test(id)
    ) {
      throw this.error(
        'MCP_INSTALLATION_ID_INVALID',
        'Invalid MCP installation id.',
      );
    }

    return id;
  }

  private requiredDigest(value: string): string {
    const digest = String(value ?? '').trim().toLowerCase();

    if (!/^[a-f0-9]{64}$/.test(digest)) {
      throw this.error(
        'MCP_EXECUTION_APPROVAL_DIGEST_INVALID',
        'Invalid MCP execution approval digest.',
      );
    }

    return digest;
  }

  private error(
    code: string,
    message: string,
  ): Error & { code: string } {
    return Object.assign(
      new Error(message),
      { code },
    );
  }
}