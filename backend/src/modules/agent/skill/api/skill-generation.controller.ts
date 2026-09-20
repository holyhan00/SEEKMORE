import {
  Body,
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUserId } from '../../../../common/decorators/current-user-id.decorator';
import { JwtGuard } from '../../../../common/guards/jwt.guard';
import { SkillGenerationService } from '../generation/skill-generation.service';
import { SkillApiSerializationInterceptor } from './interceptors/skill-api-serialization.interceptor';
import { GenerateSkillDto } from './dto/skill-generation.dto';


@Controller('skills/ai-create')
@UseGuards(JwtGuard)
@UseInterceptors(SkillApiSerializationInterceptor)
export class SkillGenerationController {
  constructor(private readonly generation: SkillGenerationService) {}

  @Post()
  create(@CurrentUserId() userId: string, @Body() dto: GenerateSkillDto) {
    return this.generation.create(userId, {
      displayName: dto.displayName,
      description: dto.description,
      license: dto.license ?? null,
      compatibility: dto.compatibility ?? null,
      metadata: dto.metadata ?? {},
      allowedTools: dto.allowedTools ?? null,
      agentId: dto.agentId ?? null,
    });
  }

}
