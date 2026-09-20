import type { ExperienceEvaluation } from '../../seekmore-agent/experience/experience-eval';
export type GrowTerminalStatus =
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'blocked'
  | 'cancelled';

export type GrowTriggerType =
  | 'explicit_learning'
  | 'explicit_correction'
  | 'explicit_preference'
  | 'tool_interval'
  | 'loaded_skill_method_failure';

export type GrowReviewStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'skipped'
  | 'failed';

export type GrowActionType =
  | 'IGNORE'
  | 'CREATE_SKILL'
  | 'CREATE_VERSION'
  | 'UPDATE_ROUTE'
  | 'ADD_RESOURCE'
  | 'WRITE_MEMORY'
  | 'EMBED_PREFERENCE'
  | 'REQUEST_STUDY';

export type GrowReasonType =
  | 'SUCCESSFUL_EXPERIENCE'
  | 'USER_PREFERENCE'
  | 'CONVERSATION_FEEDBACK'
  | 'PROFESSIONAL_STUDY'
  | 'ROUTING_GAP'
  | 'METHOD_FAILURE';

export type GrowFailureType =
  | 'method_error'
  | 'transient_environment'
  | 'dependency_missing'
  | 'user_rejection'
  | 'policy_block'
  | 'insufficient_evidence'
  | 'unknown';

export interface GrowToolExecutionSummary {
  toolName: string;
  status: 'completed' | 'failed' | 'blocked' | 'cancelled';
  summary?: string;
  errorCode?: string;
  retryable?: boolean;
  durationMs?: number;
}

export interface GrowArtifactSummary {
  type: string;
  name?: string;
  validationStatus?: 'passed' | 'failed' | 'unknown';
  summary?: string;
}

export interface GrowLoadedSkillSummary {
  skillId: string;
  versionId: string;
  name: string;
  description: string;
  source?: string;
  locked?: boolean;
  protected?: boolean;
  usageResult?: 'loaded' | 'completed' | 'failed' | 'rejected';
}

export interface GrowRelatedSkillSummary extends GrowLoadedSkillSummary {
  relevance: number;
  activationDescription?: string;
  category?: string | null;
  tags?: string[];
  routingProfile?: GrowRoutingProfile;
}

export interface GrowPublishedSkillSnapshot extends GrowRelatedSkillSummary {
  contentHash: string;
  skillMarkdown: string;
  resources?: GrowSkillResourceDraft[];
}

export interface GrowMemorySummary {
  memoryId: string;
  summary: string;
  confidence: number;
  scope?: 'global' | 'project' | 'skill' | 'conversation';
}

export interface GrowFailureSummary {
  type: GrowFailureType;
  summary: string;
}

export interface GrowTurnEvidence {
  experienceRef?: string;
  evaluation?: ExperienceEvaluation;
  turnId: string;
  traceId: string;
  userId: string;
  agentId: string;
  conversationId: string;
  userNeed: string;
  constraints: string[];
  finalResultSummary: string;
  terminalStatus: GrowTerminalStatus;
     
                                                                      
                                                                            
                                            
     
  toolIterations: number;
  toolExecutions: GrowToolExecutionSummary[];
  artifacts: GrowArtifactSummary[];
  loadedSkills: GrowLoadedSkillSummary[];
  explicitPreferences: string[];
  corrections: string[];
  acceptances: string[];
  rejections: string[];
  failures: GrowFailureSummary[];
  relevantMemories: GrowMemorySummary[];
  explicitLearningRequested?: boolean;
  occurredAt: string;
}

export interface GrowTerminalEvent {
  eventId: string;
  eventType: 'agent.turn.terminal';
  turnId: string;
  traceId: string;
  userId: string;
  agentId: string;
  conversationId: string;
  status: GrowTerminalStatus;
  occurredAt: string;
}

export interface GrowObserverState {
  userId: string;
  agentId: string;
  toolIterationsSinceReview: number;
  lastReviewAt: string | null;
  lastReviewedTurnId: string | null;
}

export interface GrowTriggerDecision {
  shouldRun: boolean;
  triggerType?: GrowTriggerType;
  reason: string;
  counters: GrowObserverState;
}

export interface GrowFocusContext {
  reviewId: string;
  trigger: {
    type: GrowTriggerType;
    turnId: string;
    traceId: string;
  };
  scope: {
    userId: string;
    agentId: string;
    conversationId: string;
    sourceTurnIds: string[];
  };
  requests: Array<{
    turnId: string;
    userNeed: string;
    constraints: string[];
  }>;
  executions: Array<{
    evaluation?: ExperienceEvaluation;
    turnId: string;
    terminalStatus: GrowTerminalStatus;
    finalResultSummary: string;
    toolIterations: number;
    toolExecutions: GrowToolExecutionSummary[];
    artifacts: GrowArtifactSummary[];
  }>;
  skills: {
    loadedSkills: GrowLoadedSkillSummary[];
    relatedSkills: GrowRelatedSkillSummary[];
  };
  feedback: {
    explicitPreferences: string[];
    corrections: string[];
    acceptances: string[];
    rejections: string[];
  };
  memory: GrowMemorySummary[];
  failures: GrowFailureSummary[];
  professionalStudy?: GrowProfessionalStudyResult[];
}

export interface GrowRoutingWeightedTerm {
  term: string;
  weight: number;
}

export interface GrowRoutingProfile {
  aliases: string[];
  positiveTerms: GrowRoutingWeightedTerm[];
  negativeTerms: GrowRoutingWeightedTerm[];
  toolNames: string[];
  capabilityKinds: string[];
  fileExtensions: string[];
  artifactTypes: string[];
}

export interface GrowSkillResourceDraft {
  path: string;
  mimeType: string;
  textContent: string;
  executable?: boolean;
}

export interface GrowProfessionalSourceSummary {
  sourceType:
    | 'OFFICIAL_DOCUMENTATION'
    | 'OFFICIAL_REPOSITORY'
    | 'STANDARD'
    | 'RESEARCH_PAPER'
    | 'REFERENCE_IMPLEMENTATION'
    | 'PROFESSIONAL_PRACTICE';
  title: string;
  publisher?: string;
  retrievedAt: string;
  summary: string;
  applicableVersions?: string[];
  authorityScore: number;
  relevanceScore: number;
}

export interface GrowProfessionalStudyRequest {
  question: string;
  context: string;
  preferredSourceTypes?: GrowProfessionalSourceSummary['sourceType'][];
}

export interface GrowProfessionalStudyResult {
  question: string;
  findings: GrowProfessionalSourceSummary[];
  limitations: string[];
}

export interface GrowFocusAction {
  action: GrowActionType;
  title: string;
  reusableGoal: string;
  reusableMethod: string[];
  validationRules: string[];
  reason: string;
  confidence: number;
  reasonTypes: GrowReasonType[];
                                                                             
                                                               
  targetSkillId?: string;
  category?: string;
  tags: string[];
  routeKeywords: string[];
  routingProfile?: GrowRoutingProfile;
  skillMarkdown?: string;
  resources?: GrowSkillResourceDraft[];
  memoryStatement?: string;
  studyRequest?: GrowProfessionalStudyRequest;
  professionalSources?: GrowProfessionalSourceSummary[];
}

export interface GrowFocusResult {
  worthLearning: boolean;
  summary: string;
  actions: GrowFocusAction[];
}

export interface GrowReviewRecord {
  id: string;
  eventId: string;
  triggerTurnId: string;
  triggerTraceId: string;
  userId: string;
  agentId: string;
  conversationId: string;
  triggerType: GrowTriggerType;
  status: GrowReviewStatus;
  evidence: GrowTurnEvidence[];
  focusResult?: GrowFocusResult;
  createdDraftIds: string[];
  publishedVersionIds: string[];
  rejectedVersionIds: string[];
  error?: {
    code: string;
    message: string;
  };
  attemptCount: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface GrowDraftProvenance {
  origin: 'GROW_FOCUS';
  reviewId: string;
  triggerTraceId: string;
  sourceTurnIds: string[];
  baseVersionId?: string;
  reasonTypes: GrowReasonType[];
  memoryIds: string[];
  professionalSources: GrowProfessionalSourceSummary[];
  generatorVersion: string;
  policyVersion: string;
}

export interface GrowSkillDraftCommand {
  ownerUserId: string;
  reviewId: string;
  name: string;
  displayName: string;
  description: string;
  category?: string;
  tags: string[];
  skillMarkdown: string;
  resources: GrowSkillResourceDraft[];
  routingProfile: GrowRoutingProfile;
  provenance: GrowDraftProvenance;
}

export interface GrowSkillVersionDraftCommand {
  ownerUserId: string;
  reviewId: string;
  skillId: string;
  baseVersionId: string;
  baseContentHash: string;
  skillMarkdown: string;
  changeLog: string;
  resources: GrowSkillResourceDraft[];
  routingProfile?: GrowRoutingProfile;
  provenance: GrowDraftProvenance;
}

export interface GrowRouteDraftCommand {
  ownerUserId: string;
  reviewId: string;
  skillId: string;
  baseVersionId: string;
  baseContentHash: string;
  routingProfile: GrowRoutingProfile;
  provenance: GrowDraftProvenance;
}

export interface GrowResourceDraftCommand {
  ownerUserId: string;
  reviewId: string;
  skillId: string;
  baseVersionId: string;
  baseContentHash: string;
  resources: GrowSkillResourceDraft[];
  provenance: GrowDraftProvenance;
}

export interface GrowDraftResult {
  draftId: string;
  skillId: string;
  versionId: string;
  kind: 'skill' | 'version' | 'route' | 'resource';
  currentPublishedVersionId?: string;
}

export interface GrowValidationIssue {
  code: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  path?: string;
}

export interface GrowValidationResult {
  passed: boolean;
  issues: GrowValidationIssue[];
  validationRunId: string;
}

export interface GrowPublicationResult {
  published: boolean;
  skillId: string;
  versionId: string;
  previousVersionId?: string;
  reason?: string;
}

export interface GrowProcessResult {
  reviewId: string;
  status: GrowReviewStatus;
  actionCount: number;
  draftIds: string[];
  publishedVersionIds: string[];
  rejectedVersionIds: string[];
}

export type GrowSkillUseOutcome =
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'load_failed';

export interface GrowSkillUseEvent {
  eventId: string;
  userId: string;
  skillId: string;
  versionId: string;
  traceId: string;
  outcome: GrowSkillUseOutcome;
  occurredAt: string;
  reason?: string;
}

export interface GrowEffectObservation {
  skillId: string;
  versionId: string;
  previousVersionId?: string;
  reviewId: string;
  userId: string;
  publishedAt: string;
  completedCount: number;
  failedCount: number;
  rejectedCount: number;
  consecutiveFailures: number;
  totalObserved: number;
  rolledBackAt?: string;
  closedAt?: string;
}
