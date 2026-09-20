import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtGuard } from '../../../../common/guards/jwt.guard';
import { SkillCapabilityCatalogService } from '../capability/skill-capability-catalog.service';
import { SkillApiSerializationInterceptor } from './interceptors/skill-api-serialization.interceptor';

@Controller('skills/catalog')
@UseGuards(JwtGuard)
@UseInterceptors(SkillApiSerializationInterceptor)
export class SkillCapabilityController {
  constructor(private readonly capabilities: SkillCapabilityCatalogService) {}

  @Get('capabilities')
  list() {
    return {
      revision: this.capabilities.revision(),
      items: this.capabilities.list().map((item) => ({
        id: item.id,
        description: item.description,
        riskLevel: item.riskLevel,
        confirmationRequired: item.confirmationRequired,
        supported: item.supported,
        available: item.available,
        generationEligible: item.generationEligible,
        providerToolIds: item.providers.map((provider) => provider.toolId),
      })),
    };
  }
}
