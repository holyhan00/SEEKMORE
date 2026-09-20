import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUserId } from '../../../../common/decorators/current-user-id.decorator';
import { JwtGuard } from '../../../../common/guards/jwt.guard';
import { SkillApiSerializationInterceptor } from './interceptors/skill-api-serialization.interceptor';
import { CreateSkillDto, CreateSkillVersionDto, QuarantineSkillDto, ReplaceSkillAclDto, SkillListQueryDto, TestSkillDto, UpdateSkillDto, UpdateSkillSourceDto, UpdateSkillVersionDto } from './dto/skill.dto';
import { SkillCommandService } from '../application/skill-command.service';
import { SkillQueryService } from '../application/skill-query.service';
import { SkillVersionService } from '../application/skill-version.service';
import { SkillLifecycleService } from '../application/skill-lifecycle.service';
import { SkillValidationService } from '../validation/skill-validation.service';
import { SkillTestService } from '../application/skill-test.service';
import { SkillGovernanceService } from '../application/skill-governance.service';
import { SkillSourceService } from '../application/skill-source.service';
import { SkillPurgeService } from '../deletion/skill-purge.service';


@Controller('skills')
@UseGuards(JwtGuard)
@UseInterceptors(SkillApiSerializationInterceptor)
export class SkillController {
  constructor(
    private readonly commands: SkillCommandService,
    private readonly queries: SkillQueryService,
    private readonly versions: SkillVersionService,
    private readonly lifecycle: SkillLifecycleService,
    private readonly validation: SkillValidationService,
    private readonly tests: SkillTestService,
    private readonly governance: SkillGovernanceService,
    private readonly sources: SkillSourceService,
    private readonly purge: SkillPurgeService,
  ) {}

  @Get() list(@CurrentUserId() userId: string, @Query() query: SkillListQueryDto) { return this.queries.list(userId, query); }
  @Post() create(@CurrentUserId() userId: string, @Body() dto: CreateSkillDto) { return this.commands.create(userId, dto); }
  @Get(':id/deleted') deletedDetail(@CurrentUserId() userId: string, @Param('id') id: string) { return this.queries.deletedDetail(userId, id); }
  @Get(':id') detail(@CurrentUserId() userId: string, @Param('id') id: string) { return this.queries.detail(userId, id); }
  @Patch(':id') update(@CurrentUserId() userId: string, @Param('id') id: string, @Body() dto: UpdateSkillDto) { return this.commands.update(userId, id, dto); }
  @Delete(':id/permanent') permanentRemove(@CurrentUserId() userId: string, @Param('id') id: string) { return this.purge.permanentlyDeleteOwned(userId, id); }
  @Delete(':id') remove(@CurrentUserId() userId: string, @Param('id') id: string) { return this.commands.softDelete(userId, id); }

  @Get(':id/versions') versionList(@CurrentUserId() userId: string, @Param('id') id: string) { return this.queries.versions(userId, id); }
  @Post(':id/versions') createVersion(@CurrentUserId() userId: string, @Param('id') id: string, @Body() dto: CreateSkillVersionDto) { return this.versions.createDraft(userId, id, dto); }
  @Patch(':id/versions/:versionId') updateVersion(@CurrentUserId() userId: string, @Param('id') id: string, @Param('versionId') versionId: string, @Body() dto: UpdateSkillVersionDto) { return this.versions.updateDraft(userId, id, versionId, dto); }
  @Post(':id/versions/:versionId/restore') restoreVersion(@CurrentUserId() userId: string, @Param('id') id: string, @Param('versionId') versionId: string) { return this.lifecycle.restoreVersion(userId, id, versionId); }

  @Post(':id/validate') validate(@CurrentUserId() userId: string, @Param('id') id: string, @Body('versionId') versionId?: string) { return this.validation.validate(userId, id, versionId); }
  @Post(':id/publish') publish(@CurrentUserId() userId: string, @Param('id') id: string, @Body('versionId') versionId?: string) { return this.lifecycle.publish(userId, id, versionId); }
  @Post(':id/disable') disable(@CurrentUserId() userId: string, @Param('id') id: string) { return this.lifecycle.setStatus(userId, id, 'disable'); }
  @Post(':id/archive') archive(@CurrentUserId() userId: string, @Param('id') id: string) { return this.lifecycle.setStatus(userId, id, 'archive'); }
  @Post(':id/restore') restore(@CurrentUserId() userId: string, @Param('id') id: string) { return this.lifecycle.setStatus(userId, id, 'restore'); }
  @Post(':id/restore-deleted') restoreDeleted(@CurrentUserId() userId: string, @Param('id') id: string) { return this.lifecycle.restoreDeleted(userId, id); }
  @Post(':id/install') install(@CurrentUserId() userId: string, @Param('id') id: string) { return this.lifecycle.install(userId, id); }
  @Delete(':id/install') uninstall(@CurrentUserId() userId: string, @Param('id') id: string) { return this.lifecycle.uninstall(userId, id); }
  @Post(':id/test') test(@CurrentUserId() userId: string, @Param('id') id: string, @Body() dto: TestSkillDto) { return this.tests.test(userId, id, dto); }
  @Get(':id/audit') audit(@CurrentUserId() userId: string, @Param('id') id: string, @Query('limit') limit?: string) { return this.queries.audit(userId, id, Number(limit ?? 100)); }
  @Get(':id/usage') usage(@CurrentUserId() userId: string, @Param('id') id: string, @Query('limit') limit?: string) { return this.queries.usage(userId, id, Number(limit ?? 100)); }
  @Get(':id/permissions') permissions(@CurrentUserId() userId: string, @Param('id') id: string) { return this.governance.permissions(userId, id); }
  @Post(':id/permissions') replacePermissions(@CurrentUserId() userId: string, @Param('id') id: string, @Body() dto: ReplaceSkillAclDto) { return this.governance.replacePermissions(userId, id, dto); }
  @Post(':id/quarantine') quarantine(@CurrentUserId() userId: string, @Param('id') id: string, @Body() dto: QuarantineSkillDto) { return this.governance.quarantine(userId, id, dto.reason); }
  @Post(':id/security-restore') restoreSecurity(@CurrentUserId() userId: string, @Param('id') id: string) { return this.governance.restoreSecurity(userId, id); }
  @Post(':id/pin') pin(@CurrentUserId() userId: string, @Param('id') id: string) { return this.governance.pin(userId, id, true); }
  @Delete(':id/pin') unpin(@CurrentUserId() userId: string, @Param('id') id: string) { return this.governance.pin(userId, id, false); }
  @Post(':id/stale') stale(@CurrentUserId() userId: string, @Param('id') id: string) { return this.governance.markStale(userId, id); }
  @Get(':id/source') source(@CurrentUserId() userId: string, @Param('id') id: string) { return this.sources.get(userId, id); }
  @Patch(':id/source') updateSource(@CurrentUserId() userId: string, @Param('id') id: string, @Body() dto: UpdateSkillSourceDto) { return this.sources.update(userId, id, dto); }

}
