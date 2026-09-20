                                                                                    
import { Injectable } from '@nestjs/common';
import JSZip = require('jszip');

import type { RenderArtifact } from '../../render.types';
import {
  failure,
  success,
  type RenderPlanDiagnostic,
  type RenderStageResult,
} from '../../planning/core/render-plan-diagnostics.types';
import type { RenderPlanningRequest } from '../../planning/core/render-plan.types';
import type { DocumentRenderPlan } from '../../planning/document/document-render-plan.types';

@Injectable()
export class DocumentRenderOutputVerifier {
  async verify(input: {
    plan: DocumentRenderPlan;
    artifact: RenderArtifact;
    request: RenderPlanningRequest;
  }): Promise<RenderStageResult<RenderArtifact>> {
    const buffer = input.artifact.buffer;

    if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
      return failure([
        this.error(
          'DOCUMENT_OUTPUT_BUFFER_MISSING',
          'Renderer returned no document buffer.',
          false,
        ),
      ]);
    }

    if (input.request.output.format === 'pdf') {
      return this.verifyPdf(input.artifact, buffer);
    }

    return this.verifyDocx(input.plan, input.artifact, buffer);
  }

  private async verifyDocx(
    plan: DocumentRenderPlan,
    artifact: RenderArtifact,
    buffer: Buffer,
  ): Promise<RenderStageResult<RenderArtifact>> {
    try {
      const zip = await JSZip.loadAsync(buffer);

      const documentFile = zip.file('word/document.xml');
      if (!documentFile) {
        return failure([
          this.error(
            'DOCUMENT_OUTPUT_XML_MISSING',
            'DOCX is missing word/document.xml.',
            false,
          ),
        ]);
      }

      const xml = await documentFile.async('string');

      const paragraphCount = (xml.match(/<w:p(?:\s|>)/g) ?? []).length;
      const tableCount = (xml.match(/<w:tbl(?:\s|>)/g) ?? []).length;

      const expectedTables = this.countPlannedTables(plan);
      const diagnostics: RenderPlanDiagnostic[] = [];

      if (paragraphCount === 0 && tableCount === 0) {
        diagnostics.push(
          this.error(
            'DOCUMENT_OUTPUT_EMPTY',
            'DOCX contains no paragraph or table content.',
            true,
          ),
        );
      }

      if (tableCount < expectedTables) {
        diagnostics.push(
          this.error(
            'DOCUMENT_OUTPUT_TABLE_MISMATCH',
            `Expected at least ${expectedTables} tables but found ${tableCount}.`,
            true,
          ),
        );
      }

      if (diagnostics.length > 0) {
        return failure(diagnostics);
      }

      return success(
        {
          ...artifact,
          sizeBytes: buffer.byteLength,
        },
        [
          {
            stage: 'verification',
            code: 'DOCUMENT_OUTPUT_VERIFIED',
            message:
              `Verified DOCX with ${paragraphCount} paragraphs, ` +
              `${tableCount} tables and ${buffer.byteLength} bytes.`,
            severity: 'info',
            repairable: false,
          },
        ],
      );
    } catch (error) {
      return failure([
        this.error(
          'DOCUMENT_OUTPUT_CONTAINER_INVALID',
          this.errorMessage(error),
          false,
        ),
      ]);
    }
  }

  private verifyPdf(
    artifact: RenderArtifact,
    buffer: Buffer,
  ): RenderStageResult<RenderArtifact> {
    const valid =
      buffer.byteLength >= 5 &&
      buffer.subarray(0, 5).toString('ascii') === '%PDF-';

    if (!valid) {
      return failure([
        this.error(
          'PDF_OUTPUT_HEADER_INVALID',
          'PDF header is invalid.',
          false,
        ),
      ]);
    }

    return success(
      {
        ...artifact,
        sizeBytes: buffer.byteLength,
      },
      [
        {
          stage: 'verification',
          code: 'PDF_OUTPUT_VERIFIED',
          message: `Verified PDF container with ${buffer.byteLength} bytes.`,
          severity: 'info',
          repairable: false,
        },
      ],
    );
  }

     
                                                                               
                                    
     
  private countPlannedTables(plan: DocumentRenderPlan): number {
    const visited = new Set<object>();

    const walk = (value: unknown): number => {
      if (value === null || typeof value !== 'object') {
        return 0;
      }

      if (visited.has(value)) {
        return 0;
      }

      visited.add(value);

      if (Array.isArray(value)) {
        let total = 0;

        for (const item of value) {
          total += walk(item);
        }

        return total;
      }

      const record = value as Record<string, unknown>;
      let total = record.type === 'table' ? 1 : 0;

      for (const child of Object.values(record)) {
        total += walk(child);
      }

      return total;
    };

    return walk(plan.composition);
  }

  private error(
    code: string,
    message: string,
    repairable: boolean,
  ): RenderPlanDiagnostic {
    return {
      stage: 'verification',
      code,
      message,
      severity: 'error',
      repairable,
    };
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }

    return String(error);
  }
}