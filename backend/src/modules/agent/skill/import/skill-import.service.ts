import {
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type {
  SkillDocumentDiagnostic,
  SkillDocumentValidationResult,
} from '../domain/skill-document.types';
import { SkillDomainError } from '../domain/skill.errors';
import { deriveSkillDisplayName } from '../domain/skill-identity.util';
import {
  sha256,
  skillPackageChecksum,
} from '../domain/skill-content.util';
import { SkillCreationService } from '../application/skill-creation.service';
import { SkillPackageScannerService } from '../security/skill-package-scanner.service';
import { SkillPathPolicy } from '../security/skill-path-policy';
import type {
  SkillImportInspectResult,
  SkillImportPackage,
} from '../specification/skill-generation.types';
import { SkillAcceptancePolicy } from '../validation/skill-acceptance.policy';
import { SkillDocumentValidator } from '../validation/skill-document.validator';
import { SkillFrontmatterParser } from '../validation/skill-frontmatter.parser';
import { SkillImportPackageReader } from './skill-import-package-reader.service';

@Injectable()
export class SkillImportService {
  constructor(
    private readonly packages: SkillImportPackageReader,
    private readonly parser: SkillFrontmatterParser,
    private readonly validator: SkillDocumentValidator,
    private readonly acceptance: SkillAcceptancePolicy,
    private readonly scanner: SkillPackageScannerService,
    private readonly paths: SkillPathPolicy,
    private readonly creation: SkillCreationService,
  ) {}

  async inspect(input: {
    userId: string;
    file?: Express.Multer.File | null;
    repositoryUrl?: string | null;
    content?: string | null;
  }): Promise<SkillImportInspectResult> {
    const packageData = await this.packages.read(input);
    const packageChecksum =
      this.packageChecksum(packageData);
    const securityDiagnostics =
      this.securityDiagnostics(packageData);

    try {
      const parsed = this.parser.parse(
        packageData.skillMarkdown,
      );
      const rootName =
        packageData.rootName ??
        parsed.manifest.name;
      const validation = this.validator.validate(
        parsed,
        {
          rootName,
          resources: packageData.resources,
        },
      );
      const decision = this.acceptance.decide({
        source: 'IMPORTED',
        report: validation,
        securityDiagnostics,
      });

      return {
        inspection: {
          inspectionToken: packageChecksum,
          sourceKind: packageData.sourceKind,
          sourceRef: packageData.sourceRef,
          sourceRevision:
            packageData.sourceRevision,
          detectedFormat:
            packageData.detectedFormat,
          rootName,
          name:
            validation.projection?.name ??
            parsed.manifest.name,
          displayName: deriveSkillDisplayName(parsed),
          description:
            validation.projection?.description ??
            parsed.manifest.description,
          skillMarkdown:
            packageData.skillMarkdown,
          files: this.fileSummaries(packageData),
          diagnostics:
            validation.diagnostics,
          validation: decision,
          security: {
            passed: decision.safe,
            diagnostics:
              securityDiagnostics,
          },
          notes: packageData.notes,
        },
      };
    } catch (error) {
      if (!(error instanceof SkillDomainError)) {
        throw error;
      }

      const diagnostic =
        this.parseDiagnostic(error);
      const validation =
        this.parseFailureReport(diagnostic);
      const decision = this.acceptance.decide({
        source: 'IMPORTED',
        report: validation,
        securityDiagnostics,
      });

      return {
        inspection: {
          inspectionToken: packageChecksum,
          sourceKind: packageData.sourceKind,
          sourceRef: packageData.sourceRef,
          sourceRevision:
            packageData.sourceRevision,
          detectedFormat:
            packageData.detectedFormat,
          rootName:
            packageData.rootName ?? '',
          name: '',
          displayName: '',
          description: '',
          skillMarkdown:
            packageData.skillMarkdown,
          files: this.fileSummaries(packageData),
          diagnostics: [diagnostic],
          validation: decision,
          security: {
            passed: decision.safe,
            diagnostics:
              securityDiagnostics,
          },
          notes: packageData.notes,
        },
      };
    }
  }

  async commit(input: {
    userId: string;
    packageChecksum: string;
    file?: Express.Multer.File | null;
    repositoryUrl?: string | null;
    content?: string | null;
  }) {
    const packageData = await this.packages.read(input);
    const actualChecksum =
      this.packageChecksum(packageData);

    if (actualChecksum !== input.packageChecksum) {
      throw new ConflictException({
        code: 'SKILL_IMPORT_PACKAGE_CHANGED',
        message:
          'The Skill package changed after inspection. Inspect it again before importing.',
      });
    }

    return this.creation.create(input.userId, {
      source: 'IMPORTED',
      sourceKind: packageData.sourceKind,
      sourceRef: packageData.sourceRef,
      sourceRevision:
        packageData.sourceRevision,
      rootName: packageData.rootName,
      skillMarkdown:
        packageData.skillMarkdown,
      resources: packageData.resources,
      provenance: {
        creationMethod: 'IMPORTED',
        detectedFormat:
          packageData.detectedFormat,
        inspectionChecksum: actualChecksum,
        notes: packageData.notes,
      },
    });
  }

  private securityDiagnostics(
    packageData: SkillImportPackage,
  ): SkillDocumentDiagnostic[] {
    return this.scanner.scan(
      packageData.skillMarkdown,
      packageData.resources.map((resource) => ({
        path: resource.path,
        sizeBytes:
          resource.buffer.byteLength,
        mimeType: resource.mimeType,
        fileType: this.paths.classify(
          resource.path,
        ),
        textContent: this.isText(
          resource.mimeType,
          resource.path,
        )
          ? resource.buffer.toString('utf8')
          : null,
      })),
    );
  }

  private fileSummaries(
    packageData: SkillImportPackage,
  ) {
    return packageData.resources.map((resource) => {
      const fileType = this.paths.classify(
        resource.path,
      );
      return {
        path: resource.path,
        mimeType: resource.mimeType,
        sizeBytes:
          resource.buffer.byteLength,
        fileType,
        executable: fileType === 'SCRIPT',
      };
    });
  }

  private packageChecksum(
    packageData: SkillImportPackage,
  ): string {
    return skillPackageChecksum(
      packageData.skillMarkdown,
      packageData.resources.map((resource) => ({
        path: resource.path,
        checksum: sha256(resource.buffer),
      })),
    );
  }

  private parseFailureReport(
    diagnostic: SkillDocumentDiagnostic,
  ): SkillDocumentValidationResult {
    return {
      valid: false,
      parseable: false,
      runnable: false,
      specCompliant: false,
      projection: null,
      diagnostics: [diagnostic],
    };
  }

  private parseDiagnostic(
    error: SkillDomainError,
  ): SkillDocumentDiagnostic {
    const details =
      error.details &&
      typeof error.details === 'object' &&
      !Array.isArray(error.details)
        ? (error.details as Record<
            string,
            unknown
          >)
        : {};

    return {
      code: error.code,
      severity: 'ERROR',
      message: error.message,
      path: 'SKILL.md',
      line:
        typeof details.line === 'number'
          ? details.line
          : null,
      column:
        typeof details.column === 'number'
          ? details.column
          : null,
    };
  }

  private isText(
    mimeType: string,
    filePath: string,
  ): boolean {
    return (
      mimeType.startsWith('text/') ||
      /\.(?:md|txt|json|yaml|yml|csv|xml|html|css|js|mjs|cjs|jsx|ts|tsx|py|sh|bash|zsh|ps1|rb|php|java|kt|kts|go|rs|swift|c|h|cc|cpp|hpp|toml|ini|properties|sql)$/i.test(
        filePath,
      )
    );
  }
}
