import { Body, Controller, Get, Param, Put, UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUserId } from '../../../../common/decorators/current-user-id.decorator';
import { JwtGuard } from '../../../../common/guards/jwt.guard';
import { SkillApiSerializationInterceptor } from './interceptors/skill-api-serialization.interceptor';
import { ReplaceAgentSkillBindingsDto, ReplaceConversationSkillsDto } from './dto/skill.dto';
import { SkillBindingService } from '../application/skill-binding.service';
import { SkillSessionService } from '../application/skill-session.service';


@Controller()
@UseGuards(JwtGuard)
@UseInterceptors(SkillApiSerializationInterceptor)
export class SkillBindingController {
  constructor(private readonly bindings: SkillBindingService, private readonly sessions: SkillSessionService) {}

  @Get('agents/cognitive/:id/skills') getBindings(@CurrentUserId() userId: string, @Param('id') id: string) { return this.bindings.get(userId, id); }
  @Put('agents/cognitive/:id/skills') replaceBindings(@CurrentUserId() userId: string, @Param('id') id: string, @Body() dto: ReplaceAgentSkillBindingsDto) { return this.bindings.replace(userId, id, dto); }
  @Get('conversations/:id/skills') getSession(@CurrentUserId() userId: string, @Param('id') id: string) { return this.sessions.list(userId, id); }
  @Put('conversations/:id/skills') replaceSession(@CurrentUserId() userId: string, @Param('id') id: string, @Body() dto: ReplaceConversationSkillsDto) { return this.sessions.replace(userId, id, dto); }

}
