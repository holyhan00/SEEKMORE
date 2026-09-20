import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../../common/guards/jwt.guard';
import { McpLibraryService } from '../application/mcp-library.service';
import { McpInstallationRuntimeService } from '../runtime/mcp-installation-runtime.service';
import { mcpUserId, type McpAuthenticatedRequest } from './mcp-user-request';

@Controller('mcp/chat')
@UseGuards(JwtGuard)
export class McpChatController {
  constructor(
    private readonly library: McpLibraryService,
    private readonly runtime: McpInstallationRuntimeService,
  ) {}

  @Get()
  async list(@Req() req: McpAuthenticatedRequest) {
    const userId = mcpUserId(req);
    await this.runtime.reconcileConnections(userId);
    await this.runtime.restoreEnabledConnections(userId);
    return this.library.chatState(userId);
  }
}
