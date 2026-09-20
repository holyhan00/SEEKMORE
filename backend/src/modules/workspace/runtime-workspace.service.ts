                                                             

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../../../prisma/prisma.service';
import { RuntimeFlowTraceLogger } from '../../common/trace/runtime-flow-trace.logger';
import { workspaceSecurityConfig } from '../../common/config/security.config';
import { appError } from '../../common/errors/app-error';
import type {
  RuntimeWorkspaceContext,
  RuntimeWorkspaceTrustLevel,
} from './contracts/runtime-workspace.types';

export interface CreateRuntimeWorkspaceInput {
  userId: string;
  agentId?: string | null;
  conversationId?: string | null;

     
                                                                      
     
  name: string;

     
                                                       
             
                  
                                            
                                                                 
     
  rootPath: string;
  source?: 'desktop_picker';
}

export interface RegisterRuntimeWorkspaceInput {
  userId: string;
  agentId?: string | null;
  conversationId?: string | null;
  rootPath: string;
  name?: string | null;
}

export interface UpdateRuntimeWorkspaceInput {
  userId: string;
  workspaceId: string;
  name: string;
}

@Injectable()
export class RuntimeWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trace: RuntimeFlowTraceLogger,
  ) {}

  async list(userId: string): Promise<RuntimeWorkspaceContext[]> {
    return this.listFromDb(userId);
  }

  async create(
    input: CreateRuntimeWorkspaceInput,
  ): Promise<RuntimeWorkspaceContext> {
    const parentRoot = this.safeRealpath(input.rootPath);

    if (!parentRoot) {
      throw new BadRequestException(appError('WORKSPACE_PARENT_UNAVAILABLE'));
    }

    this.assertSafeWorkspacePath(parentRoot);

    if (input.source !== 'desktop_picker' && !this.isAllowedParent(parentRoot)) {
      throw new BadRequestException(appError('WORKSPACE_PARENT_OUTSIDE_ROOT'));
    }

    const projectName = this.safeProjectName(input.name);
    const finalRootPath = this.resolveChildPath(parentRoot, projectName);

    if (this.pathExists(finalRootPath)) {
      throw new BadRequestException(appError('WORKSPACE_PROJECT_EXISTS'));
    }

    try {
      fs.mkdirSync(finalRootPath, { recursive: false });
    } catch {
      throw new BadRequestException(appError('WORKSPACE_CREATE_FAILED'));
    }

    const rootPath = this.safeRealpath(finalRootPath);

    if (!rootPath) {
      throw new BadRequestException(appError('WORKSPACE_UNREADABLE'));
    }

    const trustLevel: RuntimeWorkspaceTrustLevel = 'restricted';
    const name = projectName;
    const delegate = this.delegate();

    if (!delegate?.create) {
      this.removeEmptyDirectoryQuietly(rootPath);
      throw new BadRequestException({ code: 'RUNTIME_WORKSPACE_PERSISTENCE_UNAVAILABLE', message: 'runtimeWorkspace persistence is unavailable' });
    }

    const workspaceKey = `${input.userId}:${this.slug(name)}:${Date.now()}`;

    try {
      const row = await delegate.create({
        data: {
          userId: input.userId,
          agentId: input.agentId ?? null,
          conversationId: input.conversationId ?? null,
          workspaceKey,
          stateJson: {
            name,
            displayName: name,
            rootPath,
            parentRoot,
            trustLevel,
            writable: true,
            status: 'active',
            createMode: 'empty_project',
          },
        },
      });

      return (
        this.fromRow(row, workspaceKey) ?? {
          workspaceId: workspaceKey,
          rootPath,
          displayName: name,
          trustLevel,
          writable: true,
        }
      );
    } catch (error) {
      this.removeEmptyDirectoryQuietly(rootPath);
      throw error;
    }
  }

  async registerExisting(
    input: RegisterRuntimeWorkspaceInput,
  ): Promise<RuntimeWorkspaceContext> {
    const rootPath = this.safeRealpath(input.rootPath);

    if (!rootPath) {
      throw new BadRequestException(appError('WORKSPACE_UNAVAILABLE'));
    }

    this.assertSafeWorkspacePath(rootPath);

    const delegate = this.delegate();

    if (!delegate?.findMany || !delegate?.create) {
      throw new BadRequestException({ code: 'RUNTIME_WORKSPACE_PERSISTENCE_UNAVAILABLE', message: 'runtimeWorkspace persistence is unavailable' });
    }

    const rows: unknown[] = await delegate.findMany({
      where: {
        userId: input.userId,
        deletedAt: null,
      },
      take: 200,
      orderBy: {
        updatedAt: 'desc',
      },
    });

    const existing = rows
      .map((row: unknown) => this.fromRow(row, null))
      .find((workspace: RuntimeWorkspaceContext | null) => {
        return workspace?.rootPath === rootPath;
      });

    if (existing) {
      return existing;
    }

    const displayName = this.optionalProjectName(input.name) || path.basename(rootPath) || 'workspace';
    const trustLevel: RuntimeWorkspaceTrustLevel = 'restricted';
    const writable = this.canWrite(rootPath);
    const workspaceKey = `${input.userId}:${this.slug(displayName)}:${Date.now()}`;

    const row = await delegate.create({
      data: {
        userId: input.userId,
        agentId: input.agentId ?? null,
        conversationId: input.conversationId ?? null,
        workspaceKey,
        stateJson: {
          name: displayName,
          displayName,
          rootPath,
          parentRoot: path.dirname(rootPath),
          trustLevel,
          writable,
          status: 'active',
          createMode: 'existing_directory',
        },
      },
    });

    return (
      this.fromRow(row, workspaceKey) ?? {
        workspaceId: workspaceKey,
        rootPath,
        displayName,
        trustLevel,
        writable,
      }
    );
  }

  async get(
    userId: string,
    workspaceId: string,
  ): Promise<RuntimeWorkspaceContext> {
    const items = await this.list(userId);
    const found = items.find(
      (item) => item.workspaceId === workspaceId,
    );

    if (!found) {
      throw new NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'workspace not found' });
    }

    return found;
  }

  async update(
    input: UpdateRuntimeWorkspaceInput,
  ): Promise<RuntimeWorkspaceContext> {
    const delegate = this.delegate();

    if (!delegate?.findFirst || !delegate?.update) {
      throw new BadRequestException({ code: 'RUNTIME_WORKSPACE_PERSISTENCE_UNAVAILABLE', message: 'runtimeWorkspace persistence is unavailable' });
    }

    const row = await delegate.findFirst({
      where: {
        userId: input.userId,
        deletedAt: null,
        OR: [{ id: input.workspaceId }, { workspaceKey: input.workspaceId }],
      },
    });

    if (!row) {
      throw new NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'workspace not found' });
    }

    const currentState = this.record(row.stateJson);

    const name = this.safeProjectName(input.name);
    const stateJson = {
      ...currentState,
      name,
      displayName: name,
    };

    const next = await delegate.update({
      where: { id: row.id },
      data: { stateJson },
    });

    const context = this.fromRow(next, input.workspaceId);

    if (!context) {
      throw new BadRequestException({ code: 'WORKSPACE_UPDATE_INVALID', message: 'workspace update produced invalid state' });
    }

    return context;
  }

  async setDefault(userId: string, workspaceId: string): Promise<RuntimeWorkspaceContext> {
    const delegate = this.delegate();
    if (!delegate?.findFirst || !delegate?.updateMany || !delegate?.update) {
      throw new BadRequestException({ code: 'RUNTIME_WORKSPACE_PERSISTENCE_UNAVAILABLE', message: 'runtimeWorkspace persistence is unavailable' });
    }
    const row = await delegate.findFirst({
      where: { userId, deletedAt: null, OR: [{ id: workspaceId }, { workspaceKey: workspaceId }] },
    });
    if (!row) throw new NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'workspace not found' });

    const owned = await delegate.findMany({ where: { userId, deletedAt: null }, select: { id: true, stateJson: true } });
    for (const item of owned) {
      const state = this.record(item.stateJson);
      await delegate.update({
        where: { id: item.id },
        data: { stateJson: { ...state, isDefault: item.id === row.id } },
      });
    }
    const updated = await delegate.findUnique({ where: { id: row.id } });
    const context = this.fromRow(updated, workspaceId);
    if (!context) throw new BadRequestException({ code: 'WORKSPACE_DEFAULT_UPDATE_INVALID', message: 'workspace default update produced invalid state' });
    return context;
  }

  async archive(userId: string, workspaceId: string): Promise<{ ok: true }> {
    const delegate = this.delegate();

    if (!delegate?.findFirst || !delegate?.update) {
      throw new BadRequestException({ code: 'RUNTIME_WORKSPACE_PERSISTENCE_UNAVAILABLE', message: 'runtimeWorkspace persistence is unavailable' });
    }

    const row = await delegate.findFirst({
      where: {
        userId,
        deletedAt: null,
        OR: [{ id: workspaceId }, { workspaceKey: workspaceId }],
      },
    });

    if (!row) {
      throw new NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'workspace not found' });
    }

    const stateJson = {
      ...this.record(row.stateJson),
      status: 'archived',
    };

    await delegate.update({
      where: { id: row.id },
      data: { stateJson },
    });

    return { ok: true };
  }

  async verify(
    userId: string,
    workspaceId: string,
  ): Promise<RuntimeWorkspaceContext & { exists: boolean; writableProbe: boolean }> {
    const workspace = await this.get(userId, workspaceId);

    return {
      ...workspace,
      exists: Boolean(this.safeRealpath(workspace.rootPath)),
      writableProbe: this.canWrite(workspace.rootPath),
    };
  }

  private async listFromDb(
    userId: string,
  ): Promise<RuntimeWorkspaceContext[]> {
    const delegate = this.delegate();

    if (!delegate?.findMany) {
      throw new BadRequestException({ code: 'RUNTIME_WORKSPACE_PERSISTENCE_UNAVAILABLE', message: 'runtimeWorkspace persistence is unavailable' });
    }

    try {
      const rows: unknown[] = await delegate.findMany({
        where: {
          userId,
          deletedAt: null,
        },
        take: 50,
        orderBy: {
          updatedAt: 'desc',
        },
      });

      return rows
        .map((row: unknown) => this.fromRow(row, null))
        .filter(
          (item: RuntimeWorkspaceContext | null): item is RuntimeWorkspaceContext =>
            Boolean(item),
        );
    } catch (error) {
      this.trace.warn('workspace.list_db_failed', { message: error instanceof Error ? error.message : 'database unavailable' });
      throw new BadRequestException({ code: 'WORKSPACE_PERSISTENCE_UNAVAILABLE', message: 'workspace persistence is unavailable' });
    }
  }

  private fromRow(
    row: unknown,
    fallbackId: string | null,
  ): RuntimeWorkspaceContext | null {
    const record = this.record(row);
    const state = this.record(record.stateJson);
    const rootPath = this.safeRealpath(
      String(state.rootPath ?? state.root ?? '').trim(),
    );

    if (!rootPath) {
      return null;
    }

    const id = String(record.id ?? record.workspaceKey ?? fallbackId ?? '').trim();

    return {
      workspaceId: id || rootPath,
      rootPath,
      displayName:
        String(state.displayName ?? state.name ?? path.basename(rootPath) ?? id)
          .trim() || id || 'workspace',
      trustLevel: this.trustLevel(state.trustLevel, 'restricted'),
      writable: state.writable !== false,
    };
  }

  private delegate(): any {
    return (this.prisma as any).runtimeWorkspace;
  }

  private safeRealpath(candidate: string): string | null {
    if (!candidate) {
      return null;
    }

    try {
      const resolved = path.resolve(candidate);
      const real = fs.realpathSync.native(resolved);
      const stat = fs.statSync(real);

      if (!stat.isDirectory()) {
        return null;
      }

      return real;
    } catch {
      return null;
    }
  }

  private canWrite(rootPath: string): boolean {
    try {
      fs.accessSync(rootPath, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  private optionalProjectName(value: string | null | undefined): string | null {
    const text = String(value ?? '').trim();
    if (!text) return null;
    return this.safeProjectName(text);
  }

  private assertSafeWorkspacePath(rootPath: string): void {
    const resolved = path.resolve(rootPath);
    const parsed = path.parse(resolved);

    if (resolved === parsed.root) {
      throw new BadRequestException(appError('WORKSPACE_ROOT_FORBIDDEN'));
    }

    const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    const protectedRoots = this.protectedSystemRoots().map((candidate) =>
      process.platform === 'win32' ? candidate.toLowerCase() : candidate,
    );

    const blocked = protectedRoots.some((candidate) => {
      if (normalized === candidate) return true;
      const relative = path.relative(candidate, normalized);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    });

    if (blocked) {
      throw new BadRequestException(appError('WORKSPACE_SENSITIVE_PATH_FORBIDDEN'));
    }
  }

  private protectedSystemRoots(): string[] {
    if (process.platform === 'win32') {
      const systemRoot = process.env.SystemRoot || 'C:\\Windows';
      return [
        path.resolve(systemRoot),
        path.resolve(systemRoot, 'System32'),
        path.resolve(process.env.ProgramFiles || 'C:\\Program Files'),
        path.resolve(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'),
      ];
    }

    return [
      '/System',
      '/Library',
      '/private',
      '/usr',
      '/bin',
      '/sbin',
      '/etc',
      '/var',
      '/dev',
      '/proc',
      '/sys',
    ].map((candidate) => path.resolve(candidate));
  }

  private safeProjectName(value: string): string {
    const name = String(value ?? '')
      .trim()
      .replace(/[\/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);

    if (!name || name === '.' || name === '..') {
      throw new BadRequestException(appError('WORKSPACE_PROJECT_NAME_INVALID'));
    }

    return name;
  }

  private resolveChildPath(parentRoot: string, childName: string): string {
    const finalPath = path.resolve(parentRoot, childName);
    const relative = path.relative(parentRoot, finalPath);

    if (
      !relative ||
      relative.startsWith('..') ||
      path.isAbsolute(relative)
    ) {
      throw new BadRequestException(appError('WORKSPACE_PATH_INVALID'));
    }

    return finalPath;
  }

  private isAllowedParent(parentRoot: string): boolean {
    const configured = workspaceSecurityConfig().allowedParents;
    if (configured.length === 0) return false;
    return configured.some((candidate) => {
      const allowed = this.safeRealpath(candidate);
      if (!allowed) return false;
      const relative = path.relative(allowed, parentRoot);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    });
  }

  private pathExists(candidate: string): boolean {
    try {
      fs.accessSync(candidate, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private removeEmptyDirectoryQuietly(candidate: string): void {
    try {
      fs.rmdirSync(candidate);
    } catch {
                                
    }
  }

  private trustLevel(
    value: unknown,
    fallback: RuntimeWorkspaceTrustLevel,
  ): RuntimeWorkspaceTrustLevel {
    const text = String(value ?? '').trim();

    if (
      text === 'none' ||
      text === 'local_dev' ||
      text === 'trusted' ||
      text === 'restricted'
    ) {
      return text;
    }

    return fallback;
  }

  private slug(value: string): string {
    return (
      value
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'workspace'
    );
  }

  private record(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, any>;
  }
}