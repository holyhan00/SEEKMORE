import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../../common/decorators/user.decorator';
import { RuntimeWorkspaceService } from './runtime-workspace.service';
import {
  CreateRuntimeWorkspaceDto,
  RegisterRuntimeWorkspaceDto,
  SetDefaultRuntimeWorkspaceDto,
  UpdateRuntimeWorkspaceDto,
} from './runtime-workspace.dto';

@Controller('systemruntime/workspaces')
export class RuntimeWorkspaceController {
  constructor(private readonly workspaces: RuntimeWorkspaceService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    if (!user?.id) return { workspaces: [] };
    return this.workspaces.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: CreateRuntimeWorkspaceDto) {
    return this.workspaces.create({
      userId: user.id,
      name: body.name,
      rootPath: body.rootPath,
      source: body.source,
    });
  }

  @Post('register')
  registerExisting(
    @CurrentUser() user: RequestUser,
    @Body() body: RegisterRuntimeWorkspaceDto,
  ) {
    return this.workspaces.registerExisting({
      userId: user.id,
      rootPath: body.rootPath,
      name: body.name,
    });
  }

  @Post('default')
  setDefault(@CurrentUser() user: RequestUser, @Body() body: SetDefaultRuntimeWorkspaceDto) {
    return this.workspaces.setDefault(user.id, body.workspaceId);
  }

  @Get(':workspaceId')
  get(@CurrentUser() user: RequestUser, @Param('workspaceId') workspaceId: string) {
    return this.workspaces.get(user.id, workspaceId);
  }

  @Patch(':workspaceId')
  update(
    @CurrentUser() user: RequestUser,
    @Param('workspaceId') workspaceId: string,
    @Body() body: UpdateRuntimeWorkspaceDto,
  ) {
    return this.workspaces.update({ userId: user.id, workspaceId, name: body.name });
  }

  @Delete(':workspaceId')
  archive(@CurrentUser() user: RequestUser, @Param('workspaceId') workspaceId: string) {
    return this.workspaces.archive(user.id, workspaceId);
  }

  @Post(':workspaceId/verify')
  verify(@CurrentUser() user: RequestUser, @Param('workspaceId') workspaceId: string) {
    return this.workspaces.verify(user.id, workspaceId);
  }
}
