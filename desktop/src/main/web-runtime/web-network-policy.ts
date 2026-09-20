import { promises as dns } from 'node:dns';
import net from 'node:net';

export class DesktopWebNetworkPolicy {
  private readonly dnsCache = new Map<string, number>();
  async assertAllowed(rawUrl: string, mode: 'background' | 'interactive'): Promise<URL> {
    const url = this.parse(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw this.error('WEB_URL_PROTOCOL_BLOCKED', 'Only public HTTP/HTTPS URLs are allowed.');
    }

    if (mode === 'interactive') return url;

    const hostname = url.hostname.toLowerCase();
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
      throw this.error('WEB_PRIVATE_ADDRESS_BLOCKED', 'Localhost access is blocked for background web sessions.');
    }

    if (net.isIP(hostname)) {
      if (this.isPrivateIp(hostname)) {
        throw this.error('WEB_PRIVATE_ADDRESS_BLOCKED', 'Private network access is blocked for background web sessions.');
      }
      return url;
    }

    const cachedUntil = this.dnsCache.get(hostname) ?? 0;
    if (cachedUntil > Date.now()) return url;
    const records = await dns.lookup(hostname, { all: true, verbatim: false }).catch(() => []);
    if (!records.length) {
      throw this.error('WEB_DNS_RESOLUTION_FAILED', `Unable to resolve public hostname: ${hostname}`);
    }
    if (records.some((record) => this.isPrivateIp(record.address))) {
      throw this.error('WEB_PRIVATE_ADDRESS_BLOCKED', 'Resolved private network addresses are blocked for background web sessions.');
    }
    this.dnsCache.set(hostname, Date.now() + 60_000);
    return url;
  }

  isAllowedNavigation(rawUrl: string, mode: 'background' | 'interactive'): boolean {
    try {
      const url = this.parse(rawUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      if (mode === 'interactive') return true;
      const hostname = url.hostname.toLowerCase();
      return Boolean(hostname && hostname !== 'localhost' && !hostname.endsWith('.localhost') && !(net.isIP(hostname) && this.isPrivateIp(hostname)));
    } catch {
      return false;
    }
  }

  private parse(rawUrl: string): URL {
    try {
      return new URL(String(rawUrl ?? '').trim());
    } catch {
      throw this.error('WEB_URL_INVALID', 'Invalid URL.');
    }
  }

  private isPrivateIp(ip: string): boolean {
    const normalized = ip.trim().replace(/^\[|\]$/g, '').toLowerCase();
    if (net.isIPv4(normalized)) {
      const [a, b, c] = normalized.split('.').map(Number);
      return a === 0
        || a === 10
        || a === 127
        || a >= 224
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && (b === 0 || b === 168))
        || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
        || (a === 203 && b === 0 && c === 113);
    }
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice('::ffff:'.length);
      if (net.isIPv4(mapped)) return this.isPrivateIp(mapped);
    }
    if (net.isIPv6(normalized)) {
      return normalized === '::'
        || normalized === '::1'
        || normalized.startsWith('fc')
        || normalized.startsWith('fd')
        || normalized.startsWith('fe80:')
        || normalized.startsWith('ff')
        || normalized.startsWith('2001:db8:');
    }
    return true;
  }

  private error(code: string, message: string): Error {
    return Object.assign(new Error(message), { code });
  }
}
