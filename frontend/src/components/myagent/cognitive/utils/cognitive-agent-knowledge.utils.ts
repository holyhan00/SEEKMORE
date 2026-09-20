import type {
  CognitiveAgentKnowledgeFileSpec,
  KnowledgeAssetRole,
} from '../api/cognitive-agent.types';

export const COGNITIVE_AGENT_KNOWLEDGE_ACCEPT = [
  '.txt',
  '.md',
  '.json',
  '.pdf',
  '.doc',
  '.docx',
  '.xlsx',
  '.csv',
  '.html',
  '.htm',
  '.pptx',
  '.zip',
].join(',');

export function inferKnowledgeObjectKind(
  fileName: string,
): CognitiveAgentKnowledgeFileSpec['objectKind'] {
  const ext =
    fileName.split('.').pop()?.toLowerCase() || '';

  if (ext === 'xlsx') return 'xlsx';
  if (ext === 'pptx') return 'pptx';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'zip') return 'zip';

  return 'docx';
}

export function stripKnowledgeFileExtension(
  fileName: string,
): string {
  const dotIndex = fileName.lastIndexOf('.');

  return dotIndex > 0
    ? fileName.slice(0, dotIndex)
    : fileName;
}

export function buildKnowledgeFileSpec(
  file: File,
  fileIndex: number,
  objectRole: KnowledgeAssetRole = 'content_material',
): CognitiveAgentKnowledgeFileSpec {
  return {
    fileIndex,
    originalName: file.name,
    name: stripKnowledgeFileExtension(file.name),
    objectRole,
    objectKind: inferKnowledgeObjectKind(file.name),
    sortOrder: fileIndex,
    tags: [],
  };
}

export function buildKnowledgeFileSpecs(
  files: File[],
  objectRole: KnowledgeAssetRole = 'content_material',
): CognitiveAgentKnowledgeFileSpec[] {
  return files.map((file, index) =>
    buildKnowledgeFileSpec(
      file,
      index,
      objectRole,
    ),
  );
}
