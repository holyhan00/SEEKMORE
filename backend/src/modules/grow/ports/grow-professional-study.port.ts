import type {
  GrowProfessionalStudyRequest,
  GrowProfessionalStudyResult,
} from '../domain/grow.types';

export interface GrowProfessionalStudyPort {
  study(
    request: GrowProfessionalStudyRequest,
    scope: { userId: string; conversationId: string; traceId: string; reviewId: string },
  ): Promise<GrowProfessionalStudyResult>;
}
