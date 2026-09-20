import type { GrowTurnEvidence } from '../domain/grow.types';
import type { GrowLoggerPort } from '../ports/grow-logger.port';

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|private[_-]?key|authorization|cookie)\b\s*[:=]\s*[^\s,;]+/gi,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
];

export class GrowEvidenceSanitizerService {
  constructor(private readonly logger: GrowLoggerPort) {}

  sanitizeEvidence(evidence: GrowTurnEvidence): GrowTurnEvidence {
    const serialized = JSON.stringify(evidence);
    let sanitized = serialized;
    let replacements = 0;

    for (const pattern of SECRET_PATTERNS) {
      sanitized = sanitized.replace(pattern, () => {
        replacements += 1;
        return '[REDACTED]';
      });
    }

    const parsed = JSON.parse(sanitized) as GrowTurnEvidence;
    parsed.userNeed = this.limit(parsed.userNeed, 6_000);
    parsed.finalResultSummary = this.limit(parsed.finalResultSummary, 8_000);
    parsed.constraints = parsed.constraints.slice(0, 20).map((value) => this.limit(value, 500));
    parsed.explicitPreferences = parsed.explicitPreferences.slice(0, 20).map((value) => this.limit(value, 500));
    parsed.corrections = parsed.corrections.slice(0, 20).map((value) => this.limit(value, 500));
    parsed.acceptances = parsed.acceptances.slice(0, 20).map((value) => this.limit(value, 500));
    parsed.rejections = parsed.rejections.slice(0, 20).map((value) => this.limit(value, 500));

    this.logger.log({
      level: replacements > 0 ? 'warn' : 'debug',
      event: 'grow.evidence.sanitized',
      message:
        replacements > 0
          ? `Redacted ${replacements} sensitive value(s) from Grow evidence.`
          : 'Grow evidence passed sensitive-data sanitization.',
      fields: { traceId: evidence.traceId, replacements },
    });

    return parsed;
  }

  private limit(value: string, max: number): string {
    return value.length <= max ? value : `${value.slice(0, max)}…`;
  }
}
