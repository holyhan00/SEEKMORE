import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { ExploreQueryService } from './explore-query.service';

@Controller('explore')
@UseGuards(JwtGuard)
export class ExploreController {
  constructor(private readonly queries: ExploreQueryService) {}

  @Get('agents')
  agents(@CurrentUserId() userId: string, @Query('q') q?: string) {
    return this.queries.agents(userId, this.query(q));
  }

  @Get('skills')
  skills(@CurrentUserId() userId: string, @Query('q') q?: string) {
    return this.queries.skills(userId, this.query(q));
  }

  @Get('featured')
  featured(@CurrentUserId() userId: string) {
    return this.queries.featured(userId);
  }

  @Get('popular')
  popular(@CurrentUserId() userId: string) {
    return this.queries.popular(userId);
  }

  private query(value?: string): string | undefined {
    const text = String(value ?? '').trim();
    return text || undefined;
  }
}
