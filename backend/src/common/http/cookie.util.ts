export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const item of header.split(';')) {
    const index = item.indexOf('=');
    if (index < 0) continue;
    const key = item.slice(0, index).trim();
    if (key !== name) continue;
    const raw = item.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}
