import { localizeText } from '../../../../localization/localization';
import type {
  SkillFileRecord,
  SkillFileTreeDirectoryNode,
  SkillFileTreeFileNode,
  SkillFileTreeNode,
  SkillFileType,
  SkillFileUploadEntry,
} from '../types/skill.types';

type DirectoryFile = File & {
  webkitRelativePath?: string;
};

export type SkillFileSelectionKind =
  | 'FILES'
  | 'DIRECTORY';

export function normalizeSkillFilePath(
  value: string,
): string {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim();

  if (!normalized) {
    throw new Error(localizeText('skills.files.pathRequired'));
  }

  const segments = normalized.split('/');

  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..',
    )
  ) {
    throw new Error(localizeText('skills.files.invalidDirectory'));
  }

  return segments.join('/');
}

export function joinSkillFilePath(
  directory: string,
  relativePath: string,
): string {
  const target = directory.trim()
    ? normalizeSkillFilePath(directory)
    : '';

  const relative =
    normalizeSkillFilePath(relativePath);

  return target
    ? `${target}/${relative}`
    : relative;
}

export function inferSkillFileType(
  filePath: string,
): SkillFileType {
  const lower = filePath.toLowerCase();

  if (
    lower === 'license' ||
    lower.startsWith('license.')
  ) {
    return 'LICENSE';
  }

  if (lower.startsWith('references/')) {
    return 'REFERENCE';
  }

  if (lower.startsWith('scripts/')) {
    return 'SCRIPT';
  }

  if (lower.startsWith('assets/')) {
    return 'ASSET';
  }

  return 'OTHER';
}

export function prepareSkillFileUploadEntries(
  files: File[],
  targetDirectory: string,
  selectionKind: SkillFileSelectionKind,
): SkillFileUploadEntry[] {
  if (files.length === 0) {
    return [];
  }

  const sourceEntries = files.map((file) => {
    const directoryFile =
      file as DirectoryFile;

    const sourcePath =
      selectionKind === 'DIRECTORY'
        ? directoryFile.webkitRelativePath ||
          file.name
        : file.name;

    return {
      file,
      sourcePath:
        normalizeSkillFilePath(sourcePath),
    };
  });

  const firstSegments = sourceEntries.map(
    ({ sourcePath }) =>
      sourcePath.split('/')[0],
  );

  const commonRoot =
    selectionKind === 'DIRECTORY' &&
    firstSegments.length > 0 &&
    firstSegments.every(
      (segment) =>
        segment === firstSegments[0],
    )
      ? firstSegments[0]
      : null;

  const selectingCompletePackage = Boolean(
    !targetDirectory.trim() &&
      commonRoot &&
      sourceEntries.some(
        ({ sourcePath }) =>
          sourcePath.toLowerCase() ===
          `${commonRoot}/skill.md`.toLowerCase(),
      ),
  );

  const seen = new Set<string>();
  const result: SkillFileUploadEntry[] = [];

  for (const entry of sourceEntries) {
    if (
      entry.sourcePath
        .split('/')
        .some((segment) =>
          segment.startsWith('.'),
        )
    ) {
      continue;
    }

    let relativePath = entry.sourcePath;

    if (
      selectingCompletePackage &&
      commonRoot
    ) {
      relativePath = normalizeSkillFilePath(
        relativePath.slice(
          commonRoot.length + 1,
        ),
      );
    }

    const path = joinSkillFilePath(
      targetDirectory,
      relativePath,
    );

    if (path.toLowerCase() === 'skill.md') {
      continue;
    }

    if (seen.has(path)) {
      throw new Error(
        localizeText('skills.files.duplicatePath', { path }),
      );
    }

    seen.add(path);

    result.push({
      file: entry.file,
      path,
      fileType: inferSkillFileType(path),
    });
  }

  return result;
}

export function buildSkillFileTree(
  files: SkillFileRecord[],
): SkillFileTreeDirectoryNode {
  const root: SkillFileTreeDirectoryNode = {
    kind: 'directory',
    name: '',
    path: '',
    children: [],
  };

  const directories = new Map<
    string,
    SkillFileTreeDirectoryNode
  >([['', root]]);

  for (const file of files) {
    const normalizedPath =
      normalizeSkillFilePath(file.path);

    const segments =
      normalizedPath.split('/');

    let parent = root;
    let currentPath = '';

    for (
      let index = 0;
      index < segments.length - 1;
      index += 1
    ) {
      const segment = segments[index];

      currentPath = currentPath
        ? `${currentPath}/${segment}`
        : segment;

      let directory =
        directories.get(currentPath);

      if (!directory) {
        directory = {
          kind: 'directory',
          name: segment,
          path: currentPath,
          children: [],
        };

        directories.set(
          currentPath,
          directory,
        );

        parent.children.push(directory);
      }

      parent = directory;
    }

    const fileNode: SkillFileTreeFileNode = {
      kind: 'file',
      name:
        segments[segments.length - 1] ??
        normalizedPath,
      path: normalizedPath,
      file,
    };

    parent.children.push(fileNode);
  }

  sortSkillFileTree(root);

  return root;
}

export function collectDirectoryFiles(
  directory: SkillFileTreeDirectoryNode,
): SkillFileRecord[] {
  const result: SkillFileRecord[] = [];

  for (const child of directory.children) {
    if (child.kind === 'file') {
      result.push(child.file);
    } else {
      result.push(
        ...collectDirectoryFiles(child),
      );
    }
  }

  return result;
}

export function countDirectoryFiles(
  directory: SkillFileTreeDirectoryNode,
): number {
  return collectDirectoryFiles(
    directory,
  ).length;
}

export function formatSkillFileSize(
  value: string | number,
): string {
  const bytes = Number(value);

  if (!Number.isFinite(bytes) || bytes < 0) {
    return `${String(value)} bytes`;
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(
    bytes /
    (1024 * 1024)
  ).toFixed(1)} MB`;
}

function sortSkillFileTree(
  directory: SkillFileTreeDirectoryNode,
): void {
  directory.children.sort(
    (
      left: SkillFileTreeNode,
      right: SkillFileTreeNode,
    ) => {
      if (left.kind !== right.kind) {
        return left.kind === 'directory'
          ? -1
          : 1;
      }

      return left.name.localeCompare(
        right.name,
        undefined,
        {
          numeric: true,
          sensitivity: 'base',
        },
      );
    },
  );

  for (const child of directory.children) {
    if (child.kind === 'directory') {
      sortSkillFileTree(child);
    }
  }
}
