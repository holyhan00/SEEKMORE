                                                             

import { Injectable } from "@nestjs/common";
import * as JSZipModule from "jszip";
import { RenderArtifact, RenderRequest } from "../../render.types";

@Injectable()
export class ZipRenderService {
  async render(request: RenderRequest): Promise<RenderArtifact> {
    const title = String(
      request.payload?.title ?? request.title ?? "Package",
    ).trim();
    const files = this.normalizeFiles(request.payload, title);
    const ZipCtor = (JSZipModule as any).default ?? JSZipModule;
    const zip = new ZipCtor();

    for (const file of files) {
      zip.file(file.path, file.content);
    }

    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    const filename = this.ensureExtension(request.filename || title, "zip");

    const persisted = {
      buffer,
      filename,
      extension: "zip",
      mimeType: "application/zip",
      sizeBytes: buffer.length,
      userId: request.userId,
      conversationId: request.conversationId,
      requestId: request.requestId,
      source: request.source ?? "agent",
      category: "package",
      renderer: "zip-render.service",
      rendererVersion: "1.0.0",
      meta: {
        ...request.meta,
        title,
        fileCount: files.length,
      },
    };

    return persisted;
  }

  private normalizeFiles(
    payload: Record<string, unknown>,
    title: string,
  ): Array<{ path: string; content: string | Buffer }> {
    const raw = Array.isArray((payload as any)?.files)
      ? (payload as any).files
      : [];
    const files = raw
      .map((file: any, index: number) => {
        const path = this.safePath(
          file?.path ?? file?.filename ?? `file-${index + 1}.txt`,
        );
        const content = file?.contentBase64
          ? Buffer.from(String(file.contentBase64), "base64")
          : String(file?.content ?? file?.text ?? "").trim();
        return { path, content };
      })
      .filter(
        (file: { path: string; content: string | Buffer }) =>
          file.path &&
          (Buffer.isBuffer(file.content) || String(file.content).length > 0),
      );

    if (files.length) return files.slice(0, 200);
    throw new Error('ZIP_RENDER_FILES_REQUIRED: package.render.zip requires at least one explicit file.');
  }

  private safePath(value: unknown): string {
    const cleaned = String(value ?? "")
      .replace(/\\/g, "/")
      .split("/")
      .map((part) => part.replace(/[<>:"|?*]/g, "_").trim())
      .filter((part) => part && part !== "." && part !== "..")
      .join("/");

    return cleaned || "README.txt";
  }

  private ensureExtension(filename: string, ext: string): string {
    const clean = String(filename || "artifact")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "")
      .trim();
    return clean.toLowerCase().endsWith(`.${ext}`) ? clean : `${clean}.${ext}`;
  }
}
