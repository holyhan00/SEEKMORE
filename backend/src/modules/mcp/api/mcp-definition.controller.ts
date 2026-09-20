import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../../common/guards/jwt.guard';
import { McpLibraryService } from '../application/mcp-library.service';
import type { CreateMcpDefinitionDto, ImportMcpDefinitionDto } from './dto/mcp-library.dto';
import { mcpUserId, type McpAuthenticatedRequest } from './mcp-user-request';

@Controller('mcp/definitions')
@UseGuards(JwtGuard)
export class McpDefinitionController {
  constructor(private readonly library: McpLibraryService) {}

  @Get()
  list(@Req() req: McpAuthenticatedRequest) {
    return this.library.listDefinitions(mcpUserId(req));
  }

  @Post()
  create(@Req() req: McpAuthenticatedRequest, @Body() body: CreateMcpDefinitionDto) {
    return this.library.createDefinition(mcpUserId(req), body);
  }

  @Post('import')
  import(@Req() req: McpAuthenticatedRequest, @Body() body: ImportMcpDefinitionDto) {
    if (body.format !== 'claude_desktop_json') throw new BadRequestException('MCP_IMPORT_FORMAT_UNSUPPORTED');
    return body.commit === true
      ? this.library.commitImport(mcpUserId(req), body.config)
      : this.library.parseImport(body.config);
  }

  @Get(':id')
  detail(@Req() req: McpAuthenticatedRequest, @Param('id') id: string) {
    return this.library.getDefinition(mcpUserId(req), id);
  }

  @Patch(':id')
  update(@Req() req: McpAuthenticatedRequest, @Param('id') id: string, @Body() body: Partial<CreateMcpDefinitionDto>) {
    return this.library.updateDefinition(mcpUserId(req), id, body);
  }

  @Delete(':id')
  remove(@Req() req: McpAuthenticatedRequest, @Param('id') id: string) {
    return this.library.deleteDefinition(mcpUserId(req), id);
  }
}
