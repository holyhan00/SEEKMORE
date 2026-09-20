import type {
  GrowLoadedSkillSummary,
  GrowPublishedSkillSnapshot,
  GrowRelatedSkillSummary,
} from '../domain/grow.types';

export interface GrowSkillCatalogPort {
  findRelated(input: {
    userId: string;
    agentId: string;
    query: string;
    loadedSkills: GrowLoadedSkillSummary[];
    limit: number;
  }): Promise<GrowRelatedSkillSummary[]>;

     
                                                                                
                                                            
     
  readPublished(input: {
    userId: string;
    skillId: string;
  }): Promise<GrowPublishedSkillSnapshot | null>;
}
