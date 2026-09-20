                                                     
import {
  Controller,
  Get,
  UseGuards,
  Query,
  Param,
  Post,
  Body,
  Patch,
  Delete,
  BadRequestException,
  StreamableFile,
} from '@nestjs/common';
import { AgentService } from './agent.service';
import { CurrentUserId } from '../../../common/decorators/current-user-id.decorator';
import { JwtGuard } from '../../../common/guards/jwt.guard';

@Controller('agent')
@UseGuards(JwtGuard)
export class AgentController {
  constructor(private readonly agentService: AgentService) {}



  @Get('list')
  async getMyAgents(@CurrentUserId() userId: string) {
    const agents = await this.agentService.getAllForPanel(userId);
    return { code: 0, message: 'success', data: { agents, total: agents.length } };
  }

  @Get('my')
  async getMyAccessibleAgents(@CurrentUserId() userId: string) {
    const agents = await this.agentService.getAccessibleAgents(userId);
    return { code: 0, message: 'success', data: agents };
  }


  @Get(':agentId/profile/:kind')
  async getProfileImage(
    @CurrentUserId() userId: string,
    @Param('agentId') agentId: string,
    @Param('kind') kind: string,
  ) {

    if (kind !== 'avatar' && kind !== 'cover') {
      throw new BadRequestException({ code: 'AGENT_PROFILE_IMAGE_KIND_INVALID', message: 'Invalid profile image kind' });
    }

    const image = await this.agentService.getProfileImage(
      userId,
      agentId,
      kind,
    );

    return new StreamableFile(image.buffer, {
      type: image.mimeType,
      disposition: 'inline',
    });
  }

  @Get('store')
  async listStore(
    @CurrentUserId() userId: string,
    @Query('q') q?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: 'latest' | 'updated' | 'hot',
  ) {
    const data = await this.agentService.listPublicAgents({
      userId,
      keyword: q,
      cursor,
      limit: limit ? Number(limit) : 20,
      sort: sort || 'updated',
    });

    return { code: 0, message: 'success', data };
  }

  @Get('store/:id')
  async getPublicDetail(@CurrentUserId() userId: string, @Param('id') id: string) {
    const data = await this.agentService.getPublicAgentDetail(id, userId);
    return { code: 0, message: 'success', data };
  }

  @Post('store/:id/claim')
  async claimFree(@CurrentUserId() userId: string, @Param('id') id: string) {
    const data = await this.agentService.claimPublicFreeAgent(id, userId);
    return { code: 0, message: 'success', data };
  }

  @Post('store/:id/authorize')
  async authorizePaid(@CurrentUserId() userId: string, @Param('id') id: string) {
    const data = await this.agentService.authorizePaidAgent(id, userId);
    return { code: 0, message: 'success', data };
  }

  @Patch('user/:agentId/remark')
  async setRemark(
    @CurrentUserId() userId: string,
    @Param('agentId') agentId: string,
    @Body() body: { remark: string },
  ) {
    const data = await this.agentService.setRemark(userId, agentId, body?.remark ?? '');
    return { code: 0, message: 'success', data };
  }

  @Patch('user/:agentId/pin')
  async pin(
    @CurrentUserId() userId: string,
    @Param('agentId') agentId: string,
    @Body() body: { pinned: boolean },
  ) {
    const data = await this.agentService.pin(userId, agentId, !!body?.pinned);
    return { code: 0, message: 'success', data };
  }

                                   
  @Post('user/:agentId/remove-chat')
  async removeFromChat(@CurrentUserId() userId: string, @Param('agentId') agentId: string) {
    const data = await this.agentService.removeFromChat(userId, agentId);
    return { code: 0, message: 'success', data };
  }

                      
  @Post('user/:agentId/restore-chat')
  async restoreToChat(@CurrentUserId() userId: string, @Param('agentId') agentId: string) {
    const data = await this.agentService.restoreToChat(userId, agentId);
    return { code: 0, message: 'success', data };
  }

                                          
  @Delete('user/:agentId')
  async softDelete(@CurrentUserId() userId: string, @Param('agentId') agentId: string) {
    const data = await this.agentService.softDeleteUserAgent(userId, agentId);
    return { code: 0, message: 'success', data };
  }
}