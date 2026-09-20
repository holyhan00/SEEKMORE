                                                                
import { useMemo } from 'react';
import { cleanupMarks, extractSideNudges, toSafeString } from './utils/acgMarks';
import { extractSingleJsonAfterMark } from './utils/json';
import type { ContentParsingResult } from './types';

export function useContentParsing(contentInput: any): ContentParsingResult {
  const content = toSafeString(contentInput);

  return useMemo(() => {
    const CARD_OPEN = '::ACG_CARD::';
    const CARD_CLOSE = '::/ACG_CARD::';

    const stripRegex = new RegExp(`${CARD_OPEN}[\\s\\S]*?${CARD_CLOSE}`, 'g');
    const textWithoutCards = content.replace(stripRegex, '').trim();

                         
    const nudgeParsed = extractSideNudges(textWithoutCards);
    const pureText = cleanupMarks(nudgeParsed.text);
    const nudges = nudgeParsed.nudges;
    const firstNudge = nudges.length > 0 ? nudges[0] : null;

                      
    const resultPayload = extractSingleJsonAfterMark<any>(content, '::ACG_RESULT::');

                                                         
    const cards: any[] = [];
    const lastCard = null;

    return {
      pureText,
      cards,
      lastCard,
      nudges,
      firstNudge,
      resultPayload,
    };
  }, [content]);
}