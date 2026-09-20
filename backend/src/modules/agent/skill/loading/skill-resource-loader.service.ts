import { Injectable, NotFoundException } from '@nestjs/common';
import { SkillRepository } from '../persistence/skill.repository';
import { SkillFileService } from '../files/skill-file.service';
import { SkillPathPolicy } from '../security/skill-path-policy';
import { estimateTokens } from '../domain/skill-content.util';

@Injectable()
export class SkillResourceLoaderService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly files: SkillFileService,
    private readonly paths: SkillPathPolicy,
  ) {}

  async load(skillId: string, versionId: string, rawPath: string) {
    const normalizedPath = this.paths.normalize(rawPath);
    const file = await this.repository.client().skillFile.findFirst({
      where: {
        skillVersionId: versionId,
        path: normalizedPath,
        version: {
          skillId,
          skill: { deletedAt: null },
        },
      },
    });
    if (!file) throw new NotFoundException('SKILL_RESOURCE_NOT_FOUND');
    const content = await this.files.readContent(file);
    return {
      id: file.id,
      path: file.path,
      fileType: file.fileType,
      mimeType: file.mimeType,
      sizeBytes: Number(file.sizeBytes),
      checksum: file.checksum,
      executable: file.executable,
      content,
      contentAvailable: content !== null,
      tokenEstimate: content ? estimateTokens(content) : 0,
    };
  }
}
