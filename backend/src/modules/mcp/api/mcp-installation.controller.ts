import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../../common/guards/jwt.guard';
import { McpLibraryService } from '../application/mcp-library.service';
import { McpInstallationRuntimeService } from '../runtime/mcp-installation-runtime.service';
import { mcpUserId, type McpAuthenticatedRequest } from './mcp-user-request';

@Controller('mcp')
@UseGuards(JwtGuard)
export class McpInstallationController {
  constructor(
    private readonly library: McpLibraryService,
    private readonly runtime: McpInstallationRuntimeService,
  ) {}

  @Get('installations')
  async list(@Req() req: McpAuthenticatedRequest) {
    const userId = mcpUserId(req);
    await this.runtime.reconcileConnections(userId);
    return this.library.listInstallations(userId);
  }

  @Post('definitions/:serverId/install')
  install(@Req() req: McpAuthenticatedRequest, @Param('serverId') serverId: string) {
    return this.library.install(mcpUserId(req), serverId);
  }

  @Delete('installations/:id')
  uninstall(@Req() req: McpAuthenticatedRequest, @Param('id') id: string) {
    return this.library.uninstall(mcpUserId(req), id);
  }

  @Patch('preferences/global-enabled')
  setGlobalEnabled(
    @Req() req: McpAuthenticatedRequest,
    @Body() body: { enabled?: boolean },
  ) {
    if (typeof body.enabled !== 'boolean') {
      throw new BadRequestException('MCP_GLOBAL_PREFERENCE_PATCH_EMPTY');
    }
    return this.library.setGlobalMcpEnabled(mcpUserId(req), body.enabled);
  }

  @Patch('installations/:id')
  setEnabled(
    @Req() req: McpAuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { enabled?: boolean; allowedToolNames?: string[]; deniedToolNames?: string[] },
  ) {
    const userId = mcpUserId(req);
    const hasToolFilter = Array.isArray(body.allowedToolNames) || Array.isArray(body.deniedToolNames);
    if (hasToolFilter) {
      return this.library.updateToolFilter(
        userId,
        id,
        body.allowedToolNames ?? [],
        body.deniedToolNames ?? [],
      );
    }
    if (typeof body.enabled !== 'boolean') {
      throw new BadRequestException('MCP_INSTALLATION_PATCH_EMPTY');
    }
    return this.library.setEnabled(userId, id, body.enabled);
  }

  @Post('installations/:id/credentials')
  configure(@Req() req: McpAuthenticatedRequest, @Param('id') id: string, @Body() body: { values?: Record<string, string> }) {
    return this.library.configureCredential(mcpUserId(req), id, body.values ?? {});
  }

  @Post('installations/:id/connect')
  @HttpCode(HttpStatus.ACCEPTED)
  connect(@Req() req: McpAuthenticatedRequest, @Param('id') id: string) {
    return this.runtime.startConnect(mcpUserId(req), id, false);
  }

  @Post('installations/:id/disconnect')
  disconnect(@Req() req: McpAuthenticatedRequest, @Param('id') id: string) {
    return this.runtime.disconnect(mcpUserId(req), id);
  }

  @Post('installations/:id/reconnect')
  @HttpCode(HttpStatus.ACCEPTED)
  reconnect(@Req() req: McpAuthenticatedRequest, @Param('id') id: string) {
    return this.runtime.startConnect(mcpUserId(req), id, true);
  }

  @Post('installations/:id/tools/refresh')
  refresh(@Req() req: McpAuthenticatedRequest, @Param('id') id: string) {
    return this.runtime.refreshTools(mcpUserId(req), id);
  }

  @Get('installations/:id/tools')
  tools(@Req() req: McpAuthenticatedRequest, @Param('id') id: string) {
    return this.runtime.listTools(mcpUserId(req), id);
  }
}
