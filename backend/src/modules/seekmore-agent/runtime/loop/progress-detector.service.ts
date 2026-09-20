import { Injectable } from '@nestjs/common';
import type { AgentToolExecutionRecord } from '../../contracts/agent-tool.types';

@Injectable()
export class ProgressDetectorService {
  record(
    seen: Map<string, number>,
    records: AgentToolExecutionRecord[],
  ): { progressed: boolean; duplicateCount: number; allFailed: boolean } {
    let progressed = false;
    let duplicateCount = 0;
    let allFailed = records.length > 0;
    for (const record of records) {
      const count = (seen.get(record.fingerprint) ?? 0) + 1;
      seen.set(record.fingerprint, count);
      if (count === 1) progressed = true;
      else duplicateCount += 1;
      if (record.result.status === 'completed') allFailed = false;
    }
    return { progressed, duplicateCount, allFailed };
  }
}
