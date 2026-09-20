                                                             
import { safeParseJSON } from './json';
import type { SideNudge, ACGCard } from '../types';

                                         
export function toSafeString(input: any): string {
  if (typeof input === 'string') return input;
  if (input == null) return '';
  try {
    if (typeof input === 'object') return JSON.stringify(input);
    return String(input);
  } catch {
    return '';
  }
}

                            
export function cleanupMarks(textInput: any): string {
  const text = toSafeString(textInput);
  if (!text) return '';
  return text
    .replace(/::\/ACG_CARD::/g, '')
    .replace(/::ACG_CARD::/g, '')
    .replace(/::ACG_RESULT::/g, '')
    .replace(/::ACG_WELCOME::/g, '')
    .replace(/::ACG_WELCOME_PLACEHOLDER::/g, '')
    .replace(/::SIDE_NUDGE::/g, '')
    .replace(/^\s+|\s+$/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

                                                              
export function extractACGFromContent(rawInput: any): { text: string; cards: ACGCard[] } {
  const raw = toSafeString(rawInput);
  if (!raw) return { text: '', cards: [] };

  const OPEN = '::ACG_CARD::';
  const CLOSE = '::/ACG_CARD::';
  const cards: ACGCard[] = [];
  let textParts: string[] = [];
  let i = 0;

  while (true) {
    const idx = raw.indexOf(OPEN, i);
    if (idx === -1) { textParts.push(raw.slice(i)); break; }
    textParts.push(raw.slice(i, idx));

    let j = idx + OPEN.length;
    const len = raw.length;
    while (j < len && /\s/.test(raw[j])) j++;
    if (j >= len || raw[j] !== '{') { i = j; continue; }

    let k = j, depth = 0, inString = false, escape = false, endPos = -1;
    for (; k < len; k++) {
      const ch = raw[k];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
      } else {
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { endPos = k + 1; break; }
        }
      }
    }

    if (endPos === -1) { i = len; break; }

    const jsonStr = raw.slice(j, endPos);
    const obj = safeParseJSON<ACGCard>(jsonStr);
    if (obj) {
      cards.push(obj);
      let m = endPos;
      while (m < len && /\s/.test(raw[m])) m++;
      if (raw.startsWith(CLOSE, m)) i = m + CLOSE.length;
      else i = endPos;
    } else {
      i = endPos;
    }
  }

  return { text: textParts.join(''), cards };
}

                                              
export function extractSideNudges(rawInput: any): { text: string; nudges: SideNudge[] } {
  const raw = toSafeString(rawInput);
  if (!raw) return { text: '', nudges: [] };

  const MARK = '::SIDE_NUDGE::';
  const nudges: SideNudge[] = [];
  let textParts: string[] = [];
  let i = 0;

  while (true) {
    const idx = raw.indexOf(MARK, i);
    if (idx === -1) { textParts.push(raw.slice(i)); break; }
    textParts.push(raw.slice(i, idx));

    let j = idx + MARK.length;
    const len = raw.length;
    while (j < len && /\s/.test(raw[j])) j++;
    if (j >= len || raw[j] !== '{') { i = idx + MARK.length; continue; }

    let k = j, depth = 0, inString = false, escape = false, endPos = -1;
    for (; k < len; k++) {
      const ch = raw[k];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
      } else {
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { endPos = k + 1; break; }
        }
      }
    }
    if (endPos === -1) { textParts.push(raw.slice(idx)); break; }

    const jsonStr = raw.slice(j, endPos);
    const obj = safeParseJSON<SideNudge>(jsonStr);
    if (obj && typeof obj.text === 'string' && obj.text.trim()) {
      nudges.push(obj);
    }
    i = endPos;
  }

  return { text: textParts.join(''), nudges };
}