                                              
                                                                                         

import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  RenderTool,
  RenderToolDescriptor,
  RenderToolName,
} from './render.types';

@Injectable()
export class RenderRegistry {
  private readonly logger = new Logger(RenderRegistry.name);
  private readonly tools = new Map<RenderToolName, RenderTool>();

  register(tool: RenderTool): void {
    if (!tool?.descriptor?.name) {
      throw new Error('Cannot register render tool without descriptor.name');
    }

    const name = tool.descriptor.name;

    if (this.tools.has(name)) {
      this.logger.warn(`[RenderRegistry] overriding render tool: ${name}`);
    }

    this.tools.set(name, tool);

    this.logger.log(
      `[RenderRegistry] registered ${name}@${tool.descriptor.version}`,
    );
  }

  resolve(name: RenderToolName): RenderTool {
    const tool = this.tools.get(name);

    if (!tool) {
      throw new NotFoundException({ code: 'RENDER_TOOL_NOT_FOUND', message: `Render tool not found: ${name}`, params: { toolName: name } });
    }

    if (!tool.descriptor.enabled) {
      throw new NotFoundException({ code: 'RENDER_TOOL_DISABLED', message: `Render tool disabled: ${name}`, params: { toolName: name } });
    }

    return tool;
  }

  has(name: RenderToolName): boolean {
    const tool = this.tools.get(name);
    return Boolean(tool && tool.descriptor.enabled);
  }

  list(): RenderToolDescriptor[] {
    return Array.from(this.tools.values()).map((tool) => tool.descriptor);
  }

  listEnabled(): RenderToolDescriptor[] {
    return this.list().filter((tool) => tool.enabled);
  }

  health(): Array<{
    name: RenderToolName;
    version: string;
    category: string;
    enabled: boolean;
  }> {
    return this.list().map((tool) => ({
      name: tool.name,
      version: tool.version,
      category: tool.category,
      enabled: tool.enabled,
    }));
  }
}
