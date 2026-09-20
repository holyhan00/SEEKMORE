                                                                

import { BadRequestException, Injectable } from '@nestjs/common';
import type { Express } from 'express';
import {
  CognitiveCapabilityKey,
  CognitiveCapabilityProfile,
  CognitiveToolScope,
} from './cognitive-agent.types';

export const COGNITIVE_KNOWLEDGE_UPLOAD_BATCH_SIZE = 10;

@Injectable()
export class CognitiveAgentPolicy {
  private readonly allowedCapabilities: CognitiveCapabilityKey[] = [
    'chat',
    'writing',
    'planning',
    'research',
    'document',
    'coding',
    'data_analysis',

    'file_reading',
    'file_render',
    'docx_generation',
    'xlsx_generation',

    'web_search',
    'image_generation',
  ];

  private readonly allowedMimeTypes = new Set([
    'text/plain',
    'text/markdown',
    'application/json',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
    'application/x-zip-compressed',
    'text/csv',
    'text/html',
  ]);

  private readonly allowedImageMimeTypes = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
  ]);

  readonly maxKnowledgeFileSizeBytes = 20 * 1024 * 1024;
  readonly maxProfileImageSizeBytes = 5 * 1024 * 1024;

     
             
                   
                                                   
     
  getDefaultCognitiveCapabilities(): CognitiveCapabilityKey[] {
    return [
      'chat',
      'file_reading',
      'file_render',
      'docx_generation',
      'xlsx_generation',
    ];
  }

  normalizeCapabilities(input?: string | string[]): CognitiveCapabilityKey[] {
    if (!input) return this.getDefaultCognitiveCapabilities();

    let raw: unknown;

    if (Array.isArray(input)) {
      raw = input;
    } else {
      const trimmed = input.trim();

      if (!trimmed) return this.getDefaultCognitiveCapabilities();

      try {
        raw = JSON.parse(trimmed);
      } catch {
        raw = trimmed
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
    }

    if (!Array.isArray(raw)) {
      throw new BadRequestException({ code: 'COGNITIVE_CAPABILITIES_INVALID', message: 'COGNITIVE_CAPABILITIES_INVALID' });
    }

    const unique = Array.from(
      new Set(
        raw
          .map((item) => String(item).trim())
          .filter(Boolean),
      ),
    );

    for (const item of unique) {
      if (!this.allowedCapabilities.includes(item as CognitiveCapabilityKey)) {
        throw new BadRequestException({ code: 'COGNITIVE_CAPABILITY_UNSUPPORTED', message: 'COGNITIVE_CAPABILITY_UNSUPPORTED', params: { capability: item } });
      }
    }

    return unique as CognitiveCapabilityKey[];
  }

  buildCapabilityProfile(
    capabilities: CognitiveCapabilityKey[],
  ): CognitiveCapabilityProfile {
    const hasWebSearch = capabilities.includes('web_search');
    const hasFileReading = capabilities.includes('file_reading');
    const hasFileRender = capabilities.includes('file_render');

    const hasDocxGeneration =
      hasFileRender ||
      capabilities.includes('document') ||
      capabilities.includes('docx_generation');

    const hasXlsxGeneration =
      hasFileRender ||
      capabilities.includes('xlsx_generation') ||
      capabilities.includes('data_analysis');

    const hasImageGeneration = capabilities.includes('image_generation');

    return {
      domains: capabilities,
      tools: this.inferTools(capabilities),
      toolScopes: this.inferToolScopes(capabilities),

      canUseMemory: true,
      canUseKnowledge: true,
      canUseWebSearch: hasWebSearch,
      canReadObjects: hasFileReading,

      canGenerateDocuments: hasDocxGeneration,
      canGenerateSpreadsheets: hasXlsxGeneration,
      canRenderObjects: hasFileRender || hasDocxGeneration || hasXlsxGeneration,
      canGenerateImages: hasImageGeneration,

      maxKnowledgeFileSizeMb: 20,
    };
  }

  validateKnowledgeObjects(objects: Express.Multer.File[] = []): void {
    if (objects.length > COGNITIVE_KNOWLEDGE_UPLOAD_BATCH_SIZE) {
      throw new BadRequestException({
        code: 'COGNITIVE_KNOWLEDGE_UPLOAD_BATCH_LIMIT',
        message: 'COGNITIVE_KNOWLEDGE_UPLOAD_BATCH_LIMIT',
        params: { limit: COGNITIVE_KNOWLEDGE_UPLOAD_BATCH_SIZE },
      });
    }

    for (const file of objects) {
      if (file.size > this.maxKnowledgeFileSizeBytes) {
        throw new BadRequestException({ code: 'COGNITIVE_KNOWLEDGE_FILE_TOO_LARGE', message: 'COGNITIVE_KNOWLEDGE_FILE_TOO_LARGE', params: { fileName: file.originalname, maxMb: 20 } });
      }

      if (!this.allowedMimeTypes.has(file.mimetype)) {
        throw new BadRequestException({
          code: 'COGNITIVE_KNOWLEDGE_FILE_TYPE_UNSUPPORTED',
          message: 'COGNITIVE_KNOWLEDGE_FILE_TYPE_UNSUPPORTED',
          params: { fileName: file.originalname, mimeType: file.mimetype },
        });
      }
    }
  }

  validateProfileImages(
    avatarFile?: Express.Multer.File | null,
    coverFile?: Express.Multer.File | null,
  ): void {
    for (const file of [avatarFile, coverFile]) {
      if (!file) continue;

      if (!this.allowedImageMimeTypes.has(file.mimetype)) {
        throw new BadRequestException({
          code: 'COGNITIVE_IMAGE_FORMAT_UNSUPPORTED',
          message: 'COGNITIVE_IMAGE_FORMAT_UNSUPPORTED',
          params: { fileName: file.originalname },
        });
      }

      if (file.size > this.maxProfileImageSizeBytes) {
        throw new BadRequestException({ code: 'COGNITIVE_IMAGE_TOO_LARGE', message: 'COGNITIVE_IMAGE_TOO_LARGE', params: { fileName: file.originalname, maxMb: 5 } });
      }
    }
  }

  private inferTools(capabilities: CognitiveCapabilityKey[]): string[] {
    const tools = new Set<string>();

    if (capabilities.includes('web_search')) {
      tools.add('web.search');
    }

    if (capabilities.includes('file_reading')) {
      tools.add('file.read');
    }

    if (capabilities.includes('file_render')) {
      tools.add('document.render.docx');
      tools.add('spreadsheet.render.xlsx');
    }

    if (capabilities.includes('docx_generation')) {
      tools.add('document.render.docx');
    }

    if (capabilities.includes('xlsx_generation')) {
      tools.add('spreadsheet.render.xlsx');
    }

    if (capabilities.includes('image_generation')) {
      tools.add('image.generate');
    }

    return Array.from(tools);
  }

  private inferToolScopes(
    capabilities: CognitiveCapabilityKey[],
  ): CognitiveToolScope[] {
    const scopes = new Set<CognitiveToolScope>();

    if (capabilities.includes('file_reading')) {
      scopes.add('internal_file');
    }

    if (
      capabilities.includes('file_render') ||
      capabilities.includes('docx_generation') ||
      capabilities.includes('xlsx_generation') ||
      capabilities.includes('document') ||
      capabilities.includes('data_analysis')
    ) {
      scopes.add('internal_object');
    }

    if (capabilities.includes('web_search')) {
      scopes.add('external_search');
    }

    if (capabilities.includes('image_generation')) {
      scopes.add('external_generation');
    }

    return Array.from(scopes);
  }
}