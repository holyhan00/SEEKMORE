import React from 'react';
import { useLocalize } from '../../../../localization/useLocalize';
import type { CognitiveAgentKnowledgeFile } from '../api/cognitive-agent.types';

interface Props {
  files?: CognitiveAgentKnowledgeFile[];

}

function statusLabelKey(status: CognitiveAgentKnowledgeFile['parseStatus']) {
  return `agents.knowledge.status.${status || 'PENDING'}`;
}

function statusClass(status: CognitiveAgentKnowledgeFile['parseStatus']) {
  switch (status) {
    case 'READY':
      return 'bg-emerald-500/10 text-emerald-500';
    case 'PARSING':
      return 'bg-blue-500/10 text-blue-500';
    case 'FAILED':
      return 'bg-red-500/10 text-red-500';
    case 'PENDING':
    default:
      return 'bg-amber-500/10 text-amber-500';
  }
}

const CognitiveAgentKnowledgeStatus: React.FC<Props> = ({
  files = [],
  }) => {
  const localize = useLocalize();
  if (!files.length) {
    return (
      <div
        className={[
          'rounded-[10px] px-[10px] py-[9px] text-[9px]',
          'bg-[#f3f4f6] text-[#999999] dark:bg-[#151515] dark:text-[#777777]',
        ].join(' ')}
      >
        {localize('agents.knowledge.empty')}
      </div>
    );
  }

  return (
    <div className="space-y-[5px]">
      {files.map((file) => (
        <div
          key={file.id}
          className={[
            'rounded-[10px] px-[9px] py-[7px]',
            'bg-[#f3f4f6] dark:bg-[#151515]',
          ].join(' ')}
        >
          <div className="flex items-center justify-between gap-[8px]">
            <div className="min-w-0 flex-1">
              <div
                className={[
                  'truncate text-[10px] font-medium',
                  'text-[#333333] dark:text-[#eaeaea]',
                ].join(' ')}
                title={file.originalName}
              >
                {file.originalName}
              </div>

              <div
                className={[
                  'mt-[2px] truncate text-[9px]',
                  'text-[#999999] dark:text-[#777777]',
                ].join(' ')}
              >
                {localize('agents.knowledge.chunkCount', {
                  count: file.chunkCount ?? file._count?.chunks ?? 0,
                })}
                {file.embeddingModel
                  ? ` · ${file.embeddingModel}`
                  : ''}
              </div>
            </div>

            <span
              className={`shrink-0 rounded-full px-[6px] py-[3px] text-[9px] ${statusClass(
                file.parseStatus,
              )}`}
            >
              {localize(statusLabelKey(file.parseStatus))}
            </span>
          </div>

          {file.parseError && (
            <div className="mt-[4px] break-words text-[9px] text-red-400">
              {file.parseError}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default CognitiveAgentKnowledgeStatus;
