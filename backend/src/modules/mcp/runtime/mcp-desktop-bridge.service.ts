                                                                

import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

interface Descriptor {
  port: number;
  token: string;
  pid: number;
}

type DesktopRuntimeErrorBody = {
  ok?: boolean;
  error?: {
    code?: string;
    message?: string;
    detail?: unknown;
  };
};


export function resolveDesktopRuntimeDescriptorPath(
  env: NodeJS.ProcessEnv = process.env,
  temporaryRoot: string = tmpdir(),
): string {
  const configured = String(
    env.SEEKMORE_DESKTOP_RUNTIME_DESCRIPTOR_PATH ?? '',
  ).trim();

  return configured
    ? resolve(configured)
    : join(temporaryRoot, 'seekmore-desktop-web-runtime.json');
}

@Injectable()
export class McpDesktopBridgeService {
  private readonly descriptorPath = resolveDesktopRuntimeDescriptorPath();

  async invoke<T = unknown>(
    operation: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const descriptor = await this.readDescriptor();
    let response: Response;

    try {
      response = await fetch(
        `http://127.0.0.1:${descriptor.port}/v1/invoke`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${descriptor.token}`,
          },
          body: JSON.stringify({ operation, payload }),
          signal: AbortSignal.timeout(this.requestTimeout(payload)),
        },
      );
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw Object.assign(
        new Error(
          timedOut
            ? 'Desktop MCP Runtime request timed out.'
            : 'Desktop MCP Runtime is unreachable.',
        ),
        {
          code: timedOut
            ? 'MCP_DESKTOP_BRIDGE_TIMEOUT'
            : 'MCP_DESKTOP_RUNTIME_UNAVAILABLE',
          detail: {
            operation,
            desktopPid: descriptor.pid,
          },
        },
      );
    }

    const body = await this.readResponse<T>(response);
    if (!response.ok || !body.ok) {
      throw Object.assign(
        new Error(
          body.error?.message ?? 'MCP_DESKTOP_RUNTIME_ERROR',
        ),
        {
          code:
            body.error?.code ?? 'MCP_DESKTOP_RUNTIME_ERROR',
          detail: body.error?.detail,
        },
      );
    }

    return body.data as T;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.invoke('mcp_health', {});
      return true;
    } catch {
      return false;
    }
  }

  private async readDescriptor(): Promise<Descriptor> {
    try {
      const descriptor = JSON.parse(
        await readFile(this.descriptorPath, 'utf8'),
      ) as Partial<Descriptor>;

      if (
        !Number.isInteger(descriptor.port) ||
        Number(descriptor.port) <= 0 ||
        typeof descriptor.token !== 'string' ||
        descriptor.token.length < 32 ||
        !Number.isInteger(descriptor.pid)
      ) {
        throw new Error('DESCRIPTOR_INVALID');
      }

      return descriptor as Descriptor;
    } catch {
      throw new ServiceUnavailableException(
        'MCP_DESKTOP_RUNTIME_UNAVAILABLE',
      );
    }
  }

  private async readResponse<T>(
    response: Response,
  ): Promise<{
    ok?: boolean;
    data?: T;
    error?: DesktopRuntimeErrorBody['error'];
  }> {
    try {
      return (await response.json()) as {
        ok?: boolean;
        data?: T;
        error?: DesktopRuntimeErrorBody['error'];
      };
    } catch {
      throw Object.assign(
        new Error('Desktop MCP Runtime returned an invalid response.'),
        {
          code: 'MCP_DESKTOP_RUNTIME_RESPONSE_INVALID',
          detail: { status: response.status },
        },
      );
    }
  }

  private requestTimeout(
    payload: Record<string, unknown>,
  ): number {
    const explicitBridgeTimeout = Number(payload.bridgeTimeoutMs);
    if (Number.isFinite(explicitBridgeTimeout)) {
      return Math.min(
        900_000,
        Math.max(10_000, explicitBridgeTimeout),
      );
    }

    const requested = Number(payload.timeoutMs ?? 120_000);
    if (!Number.isFinite(requested)) {
      return 120_000;
    }

    return Math.min(
      330_000,
      Math.max(10_000, requested + 10_000),
    );
  }
}
