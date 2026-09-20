import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Body,
} from '@nestjs/common';
import { CurrentUserId } from '../common/decorators/current-user-id.decorator';
import { UpdateToolEnabledDto } from './tool-registry.dto';
import { ToolsRegistry } from './toolsregistry';

@Controller('tools')
export class ToolsController {
  constructor(
    private readonly registry: ToolsRegistry,
  ) {}

  @Get('registry')
  @HttpCode(200)
  async listRegistry(
    @CurrentUserId() userId: string,
  ) {
    return this.registryResponse(userId);
  }

  @Patch('registry/:toolName/enabled')
  @HttpCode(200)
  async updateEnabled(
    @CurrentUserId() userId: string,
    @Param('toolName') toolName: string,
    @Body() input: UpdateToolEnabledDto,
  ) {
    const normalizedToolName =
      String(toolName ?? '').trim();

    const updated =
      await this.registry.setEnabledForUser(
        userId,
        normalizedToolName,
        input.enabled,
      );

    if (!updated) {
      throw new NotFoundException({
        code: 'TOOL_NOT_FOUND',
        message: `Tool not found: ${normalizedToolName}`,
        params: { toolName: normalizedToolName },
      });
    }

    return this.registryResponse(userId);
  }

  private async registryResponse(
    userId: string,
  ) {
    const tools =
      await this.registry.listToolsForUser(
        userId,
      );

    return {
      ok: true,
      userId,
      count: tools.length,
      tools,
      executionEndpoint: null,
      message:
        'Tools are executed only through the authorized SystemRuntime workflow.',
    };
  }


}
