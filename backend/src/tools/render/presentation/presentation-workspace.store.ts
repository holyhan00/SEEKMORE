import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { ToolError } from '../../toolstypes';
import type {
  PresentationDraftDocument,
  PresentationDraftPartition,
  PresentationDraftSlideSpec,
} from './presentation-draft.types';

const MANIFEST_FILENAME = 'presentation.json';
const SLIDES_DIRECTORY = 'slides';

type StoredSlideRef = {
  id: string;
  path: string;
  revision: number;
  updatedAt: string;
};

type StoredPresentationManifest = Omit<PresentationDraftDocument, 'slides'> & {
  slides: Record<string, StoredSlideRef>;
};

type StoredPresentationSlide = {
  presentationId: string;
  slideId: string;
  revision: number;
  updatedAt: string;
  slide: PresentationDraftSlideSpec;
};

@Injectable()
export class PresentationWorkspaceStore {
  private readonly mutationQueues = new Map<string, Promise<void>>();

  async create(
    partition: PresentationDraftPartition,
    build: (id: string, now: string) => PresentationDraftDocument,
  ): Promise<PresentationDraftDocument> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const document = build(id, now);
    this.assertPartition(document, partition);
    await this.persist(document, null);
    return this.clone(document);
  }

  async read(
    id: string,
    partition: PresentationDraftPartition,
  ): Promise<PresentationDraftDocument> {
    const manifestPath = this.manifestPath(id, partition);
    let manifest: StoredPresentationManifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as StoredPresentationManifest;
      if (manifest.id !== id) {
        throw new Error('presentation manifest identity mismatch');
      }
    } catch (error) {
      if (this.notFound(error)) {
        throw new ToolError(
          'PRESENTATION_SESSION_NOT_FOUND',
          'Presentation draft was not found in persistent presentation storage.',
          { presentationId: id },
        );
      }
      throw new ToolError(
        'PRESENTATION_STORAGE_READ_FAILED',
        'Presentation draft could not be read from persistent storage.',
        { presentationId: id, message: error instanceof Error ? error.message : String(error) },
      );
    }

    const base = manifest as unknown as PresentationDraftDocument;
    this.assertPartition(base, partition);
    const slides: Record<string, PresentationDraftSlideSpec> = {};
    for (const slideId of Object.keys(manifest.slides ?? {})) {
      try {
        const stored = JSON.parse(
          await readFile(this.slidePath(id, partition, slideId), 'utf8'),
        ) as StoredPresentationSlide;
        if (
          stored.presentationId !== id
          || stored.slideId !== slideId
        ) {
          throw new Error('slide identity mismatch');
        }
        slides[slideId] = stored.slide;
      } catch (error) {
        throw new ToolError(
          'PRESENTATION_SLIDE_STORAGE_INVALID',
          'A persisted presentation slide could not be read safely.',
          {
            presentationId: id,
            slideId,
            message: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    return this.clone({
      ...manifest,
      slides,
    } as unknown as PresentationDraftDocument);
  }

  async mutate<T>(
    id: string,
    partition: PresentationDraftPartition,
    operation: (document: PresentationDraftDocument) => T | Promise<T>,
  ): Promise<{ document: PresentationDraftDocument; result: T }> {
    const queueKey = this.queueKey(id, partition);
    return this.runExclusive(queueKey, async () => {
      const document = await this.read(id, partition);
      const before = this.clone(document);
      const result = await operation(document);
      document.updatedAt = new Date().toISOString();
      await this.persist(document, before);
      return { document: this.clone(document), result };
    });
  }

  private async persist(
    document: PresentationDraftDocument,
    previous: PresentationDraftDocument | null,
  ): Promise<void> {
    this.assertPartition(document, document.partition);
    const root = this.presentationRoot(document.id, document.partition);
    const slidesRoot = path.join(root, SLIDES_DIRECTORY);
    await mkdir(slidesRoot, { recursive: true, mode: 0o700 });

    const previousSlides = previous?.slides ?? {};
    const nextRefs: Record<string, StoredSlideRef> = {};
    const now = document.updatedAt || new Date().toISOString();

    for (const [slideId, slide] of Object.entries(document.slides ?? {})) {
      const relative = `${SLIDES_DIRECTORY}/${this.segment(slideId)}.json`;
      const absolute = path.join(root, relative);
      const changed = !previousSlides[slideId]
        || JSON.stringify(previousSlides[slideId]) !== JSON.stringify(slide);
      if (changed) {
        const stored: StoredPresentationSlide = {
          presentationId: document.id,
          slideId,
          revision: document.revision,
          updatedAt: now,
          slide,
        };
        await this.atomicJson(absolute, stored);
      }
      nextRefs[slideId] = {
        id: slideId,
        path: relative,
        revision: document.revision,
        updatedAt: now,
      };
    }

    for (const slideId of Object.keys(previousSlides)) {
      if (document.slides[slideId]) continue;
      await rm(
        path.join(slidesRoot, `${this.segment(slideId)}.json`),
        { force: true },
      ).catch(() => undefined);
    }

    const { slides: _slides, ...rest } = document;
    const manifest: StoredPresentationManifest = {
      ...rest,
      slides: nextRefs,
    };
    await this.atomicJson(path.join(root, MANIFEST_FILENAME), manifest);
  }

  private async atomicJson(filePath: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    const data = `${JSON.stringify(value, null, 2)}\n`;
    try {
      await writeFile(temporary, data, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, filePath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new ToolError(
        'PRESENTATION_STORAGE_WRITE_FAILED',
        'Presentation draft could not be persisted safely.',
        { filePath, message: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  private async runExclusive<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.mutationQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => current);
    this.mutationQueues.set(key, queued);

    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.mutationQueues.get(key) === queued) {
        this.mutationQueues.delete(key);
      }
    }
  }

  private assertPartition(
    document: Pick<PresentationDraftDocument, 'id' | 'partition'>,
    partition: PresentationDraftPartition,
  ): void {
    if (
      document.partition.userId !== partition.userId
      || document.partition.agentId !== partition.agentId
      || document.partition.conversationId !== partition.conversationId
    ) {
      throw new ToolError(
        'PRESENTATION_SESSION_NOT_FOUND',
        'Presentation draft was not found in the active conversation partition.',
        { presentationId: document.id },
      );
    }
  }

  private slidePath(
    id: string,
    partition: PresentationDraftPartition,
    slideId: string,
  ): string {
    return path.join(
      this.presentationRoot(id, partition),
      SLIDES_DIRECTORY,
      `${this.segment(slideId)}.json`,
    );
  }

  private manifestPath(id: string, partition: PresentationDraftPartition): string {
    return path.join(this.presentationRoot(id, partition), MANIFEST_FILENAME);
  }

  private presentationRoot(id: string, partition: PresentationDraftPartition): string {
    const cleanId = String(id ?? '').trim();
    if (!/^[0-9a-fA-F-]{20,80}$/.test(cleanId)) {
      throw new ToolError('PRESENTATION_ID_INVALID', 'presentationId is invalid.');
    }
    return path.join(
      this.storageRoot(),
      this.segment(partition.userId),
      this.segment(partition.agentId),
      this.segment(partition.conversationId),
      cleanId,
    );
  }

  private storageRoot(): string {
    const explicit = String(process.env.PRESENTATION_STORAGE_ROOT ?? '').trim();
    return path.resolve(explicit || path.join(process.cwd(), 'storage', 'presentations'));
  }

  private segment(value: string): string {
    const text = String(value ?? '').trim();
    if (!text) throw new ToolError('PRESENTATION_CONTEXT_REQUIRED', 'Presentation storage partition is incomplete.');
    return Buffer.from(text, 'utf8').toString('base64url');
  }

  private queueKey(id: string, partition: PresentationDraftPartition): string {
    return [
      this.segment(partition.userId),
      this.segment(partition.agentId),
      this.segment(partition.conversationId),
      encodeURIComponent(id),
    ].join(':');
  }

  private notFound(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT');
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
