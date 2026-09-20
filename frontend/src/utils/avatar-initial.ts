export function getAvatarInitial(
  value?: string | null,
  fallback = '',
): string {
  const normalized = String(value ?? '').trim();
  const source = normalized.includes('@')
    ? normalized.split('@')[0]?.trim() || normalized
    : normalized;

  const first = Array.from(source)[0];
  if (!first) {
    return fallback;
  }

  return /[a-z]/i.test(first)
    ? first.toLocaleUpperCase()
    : first;
}
