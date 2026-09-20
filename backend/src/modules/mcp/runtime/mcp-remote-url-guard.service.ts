import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { dynamicImport } from './mcp-dynamic-import';

const METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.google.com',
]);

type ResolvedAddress = { address: string; family: 4 | 6 };

@Injectable()
export class McpRemoteUrlGuardService {
  async assertAllowed(
    raw: string,
    allowedDomains: string[] = [],
    deniedDomains: string[] = [],
  ): Promise<URL> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new BadRequestException('MCP_ENDPOINT_INVALID');
    }
    if (url.protocol !== 'https:') {
      throw new BadRequestException('MCP_ENDPOINT_HTTPS_REQUIRED');
    }
    if (url.username || url.password) {
      throw new BadRequestException('MCP_ENDPOINT_CREDENTIALS_NOT_ALLOWED');
    }
    await this.resolveAllowed(url.hostname, allowedDomains, deniedDomains);
    return url;
  }

  createValidatedFetch(
    allowedDomains: string[],
    deniedDomains: string[],
    maxBytes: number,
  ) {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const rawUrl = input instanceof URL
        ? input.toString()
        : typeof input === 'string'
          ? input
          : input.url;
      const current = await this.assertAllowed(rawUrl, allowedDomains, deniedDomains);
      const addresses = await this.resolveAllowed(
        current.hostname,
        allowedDomains,
        deniedDomains,
      );
      const address = addresses[0];
      const { fetch: undiciFetch, Agent } = await this.undici();
      const dispatcher = new Agent({
        connect: {
          lookup: (
            _hostname: string,
            _options: unknown,
            callback: (error: Error | null, address?: string, family?: number) => void,
          ) => callback(null, address.address, address.family),
        },
      });
      let response: Response;
      try {
        response = await undiciFetch(current, {
          ...init,
          redirect: 'manual',
          dispatcher,
        }) as Response;
      } catch (error) {
        await Promise.resolve(dispatcher.close()).catch(() => undefined);
        throw error;
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        await Promise.resolve(dispatcher.close()).catch(() => undefined);
        throw new BadRequestException('MCP_REDIRECT_NOT_ALLOWED');
      }
      const length = Number(response.headers.get('content-length') ?? 0);
      if (Number.isFinite(length) && length > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        await Promise.resolve(dispatcher.close()).catch(() => undefined);
        throw new BadRequestException('MCP_RESPONSE_TOO_LARGE');
      }
      return this.limitResponse(response, dispatcher, maxBytes);
    };
  }

  private async resolveAllowed(
    rawHostname: string,
    allowedDomains: string[],
    deniedDomains: string[],
  ): Promise<ResolvedAddress[]> {
    const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!hostname || METADATA_HOSTS.has(hostname) || hostname === 'localhost') {
      throw new BadRequestException('MCP_ENDPOINT_PRIVATE_NETWORK_DENIED');
    }
    if (deniedDomains.some((domain) => this.matches(hostname, domain))) {
      throw new BadRequestException('MCP_ENDPOINT_DOMAIN_DENIED');
    }
    if (
      allowedDomains.length > 0
      && !allowedDomains.some((domain) => this.matches(hostname, domain))
    ) {
      throw new BadRequestException('MCP_ENDPOINT_DOMAIN_NOT_ALLOWED');
    }
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) as 4 | 6 }]
      : await lookup(hostname, { all: true, verbatim: true }) as ResolvedAddress[];
    if (
      addresses.length === 0
      || addresses.some(({ address }) => this.isPrivateAddress(address))
    ) {
      throw new BadRequestException('MCP_ENDPOINT_PRIVATE_NETWORK_DENIED');
    }
    return addresses;
  }

  private limitResponse(response: Response, dispatcher: any, maxBytes: number): Response {
    if (!response.body) {
      void Promise.resolve(dispatcher.close()).catch(() => undefined);
      return response;
    }
    const reader = response.body.getReader();
    let total = 0;
    const body = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        try {
          const next = await reader.read();
          if (next.done) {
            controller.close();
            await Promise.resolve(dispatcher.close()).catch(() => undefined);
            return;
          }
          total += next.value.byteLength;
          if (total > maxBytes) {
            await reader.cancel('MCP_RESPONSE_TOO_LARGE').catch(() => undefined);
            controller.error(new BadRequestException('MCP_RESPONSE_TOO_LARGE'));
            await Promise.resolve(dispatcher.close()).catch(() => undefined);
            return;
          }
          controller.enqueue(next.value);
        } catch (error) {
          controller.error(error);
          await Promise.resolve(dispatcher.close()).catch(() => undefined);
        }
      },
      cancel: async (reason) => {
        await reader.cancel(reason).catch(() => undefined);
        await Promise.resolve(dispatcher.close()).catch(() => undefined);
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  private async undici(): Promise<{ fetch: (...args: any[]) => Promise<unknown>; Agent: new (options: unknown) => any }> {
    try {
      const module = await dynamicImport('undici');
      if (typeof module.fetch !== 'function' || typeof module.Agent !== 'function') {
        throw new Error('UNDICI_EXPORTS_MISSING');
      }
      return module as { fetch: (...args: any[]) => Promise<unknown>; Agent: new (options: unknown) => any };
    } catch (error) {
      throw new ServiceUnavailableException({
        code: 'MCP_SECURE_HTTP_RUNTIME_MISSING',
        message: 'Install undici to enable DNS-pinned MCP Streamable HTTP.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private matches(hostname: string, candidate: string): boolean {
    const domain = String(candidate ?? '').trim().toLowerCase().replace(/^\./, '');
    return Boolean(domain) && (hostname === domain || hostname.endsWith(`.${domain}`));
  }

  private isPrivateAddress(address: string): boolean {
    const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
    const family = isIP(normalized);
    if (family === 6) {
      const bytes = this.ipv6Bytes(normalized);
      if (!bytes) return true;
      const mapped = bytes.slice(0, 10).every((value) => value === 0)
        && bytes[10] === 0xff
        && bytes[11] === 0xff;
      if (mapped) {
        return this.isPrivateIpv4([bytes[12], bytes[13], bytes[14], bytes[15]]);
      }
                                                                         
                                                                     
                                                                            
      if (bytes[0] < 0x20 || bytes[0] > 0x3f) return true;
      if (bytes[0] === 0x20 && bytes[1] === 0x01) {
        const third = bytes[2];
        const fourth = bytes[3];
        if ((third === 0x0d && fourth === 0xb8)                               
          || (third === 0x00 && fourth === 0x00)                            
          || (third === 0x00 && (fourth & 0xf0) === 0x10)                       
          || (third === 0x00 && (fourth & 0xf0) === 0x20)) {                         
          return true;
        }
      }
      if (bytes[0] === 0x20 && bytes[1] === 0x02) return true;                    
      if (bytes[0] === 0x3f && bytes[1] === 0xff) return true;                 
      return false;
    }
    if (family !== 4) return true;
    return this.isPrivateIpv4(normalized.split('.').map(Number));
  }

  private isPrivateIpv4(parts: number[]): boolean {
    if (parts.length !== 4 || parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      return true;
    }
    const [a, b, c] = parts;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0)
      || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 88 && c === 99)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a >= 224;
  }

  private ipv6Bytes(address: string): number[] | null {
    const ipv4Match = address.match(/(\d+\.\d+\.\d+\.\d+)$/);
    let normalized = address;
    let ipv4Hextets: string[] = [];
    if (ipv4Match) {
      const parts = ipv4Match[1].split('.').map(Number);
      if (parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null;
      ipv4Hextets = [
        ((parts[0] << 8) | parts[1]).toString(16),
        ((parts[2] << 8) | parts[3]).toString(16),
      ];
      normalized = normalized.slice(0, -ipv4Match[1].length).replace(/:$/, '');
    }
    const halves = normalized.split('::');
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
    const missing = 8 - left.length - right.length - ipv4Hextets.length;
    if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
    const hextets = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right, ...ipv4Hextets];
    if (hextets.length !== 8 || hextets.some((item) => !/^[0-9a-f]{1,4}$/i.test(item))) return null;
    return hextets.flatMap((item) => {
      const value = Number.parseInt(item, 16);
      return [(value >> 8) & 0xff, value & 0xff];
    });
  }
}
