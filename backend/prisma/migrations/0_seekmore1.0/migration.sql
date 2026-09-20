-- SEEKMORE 1.0 database baseline

CREATE EXTENSION IF NOT EXISTS vector;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MessageObjectRole" AS ENUM ('USER_INPUT', 'ASSISTANT_OUTPUT');

-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'CANCELLING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChatTurnRequestStatus" AS ENUM ('QUEUED', 'STARTING', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_EXTERNAL', 'WAITING_USER', 'CANCELLING', 'CANCELLED', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "ChatTurnCleanupStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'CONFIRMED', 'PARTIAL', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "LlmCredentialStatus" AS ENUM ('UNVERIFIED', 'VALID', 'INVALID', 'RATE_LIMITED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "StartFullAttemptStatus" AS ENUM ('RUNNING', 'FAILED', 'DONE');

-- CreateEnum
CREATE TYPE "StartFullAttemptStage" AS ENUM ('INIT', 'GROUP', 'CEO', 'PLAN', 'GRAPH', 'ORG', 'KICKOFF', 'EXECUTION', 'DONE');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "SkillStatus" AS ENUM ('DRAFT', 'VALIDATING', 'ACTIVE', 'DISABLED', 'STALE', 'ARCHIVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SkillVersionStatus" AS ENUM ('DRAFT', 'VALIDATING', 'PUBLISHED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "SkillVisibility" AS ENUM ('PRIVATE', 'ORGANIZATION', 'PUBLIC');

-- CreateEnum
CREATE TYPE "SkillSourceKind" AS ENUM ('BUILTIN', 'REPOSITORY', 'UPLOAD', 'INLINE', 'IMPORTED');

-- CreateEnum
CREATE TYPE "SkillTrustLevel" AS ENUM ('BUILTIN', 'TRUSTED', 'COMMUNITY', 'USER');

-- CreateEnum
CREATE TYPE "SkillSecurityState" AS ENUM ('CLEAR', 'REVIEW_REQUIRED', 'QUARANTINED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "SkillActivationMode" AS ENUM ('MANUAL', 'AUTOMATIC', 'ALWAYS', 'DISABLED');

-- CreateEnum
CREATE TYPE "SkillVersionPolicy" AS ENUM ('FOLLOW_CURRENT', 'PINNED', 'CONSTRAINT');

-- CreateEnum
CREATE TYPE "SkillFileType" AS ENUM ('REFERENCE', 'SCRIPT', 'ASSET', 'LICENSE', 'OTHER');

-- CreateEnum
CREATE TYPE "SkillSchemaKind" AS ENUM ('INPUT', 'OUTPUT', 'CONFIG');

-- CreateEnum
CREATE TYPE "SkillValidationStatus" AS ENUM ('PENDING', 'RUNNING', 'PASSED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SkillInstallationStatus" AS ENUM ('INSTALLED', 'DISABLED', 'UPDATE_AVAILABLE', 'QUARANTINED', 'UNINSTALLED');

-- CreateEnum
CREATE TYPE "SkillPrincipalType" AS ENUM ('USER', 'ORGANIZATION', 'TENANT', 'PUBLIC');

-- CreateEnum
CREATE TYPE "SkillPermissionAction" AS ENUM ('VIEW', 'USE', 'EDIT', 'MANAGE', 'INSTALL');

-- CreateEnum
CREATE TYPE "SkillActivationSource" AS ENUM ('USER_EXPLICIT', 'SESSION_OVERRIDE', 'AGENT_BINDING', 'PUBLIC_RELEVANCE', 'ALWAYS_PRELOAD', 'MODEL_RESOLUTION');

-- CreateEnum
CREATE TYPE "SkillUsageOutcome" AS ENUM ('SELECTED', 'LOADED', 'COMPLETED', 'FAILED', 'REJECTED', 'DEPENDENCY_MISSING');

-- CreateEnum
CREATE TYPE "GrowReviewStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "GrowTriggerType" AS ENUM ('EXPLICIT_LEARNING', 'EXPLICIT_CORRECTION', 'EXPLICIT_PREFERENCE', 'TOOL_INTERVAL', 'LOADED_SKILL_METHOD_FAILURE');

-- CreateEnum
CREATE TYPE "SeekmoreEntityType" AS ENUM ('COGNITIVE', 'SERVICE');

-- CreateEnum
CREATE TYPE "KnowledgeParseStatus" AS ENUM ('PENDING', 'PARSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PLUS', 'PRO');

-- CreateEnum
CREATE TYPE "MemoryType" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "GroupRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'BOT');

-- CreateEnum
CREATE TYPE "MemberType" AS ENUM ('USER', 'AGENT', 'SERVICE');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('SYSTEM', 'USER', 'ASSISTANT', 'TOOL');

-- CreateEnum
CREATE TYPE "AgentVisibility" AS ENUM ('PRIVATE', 'PUBLIC_FREE', 'PUBLIC_PAID');

-- CreateEnum
CREATE TYPE "GroupVisibility" AS ENUM ('PRIVATE', 'SHARED_LINK', 'PUBLIC');

-- CreateEnum
CREATE TYPE "AgentAccessLevel" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "ExecutionStage" AS ENUM ('Bootstrap', 'Executing', 'QA', 'Delivery', 'Done', 'Failed');

-- CreateEnum
CREATE TYPE "OrgCoordinationMode" AS ENUM ('hierarchical', 'peer', 'hybrid', 'auto');

-- CreateEnum
CREATE TYPE "OrgRoleKind" AS ENUM ('CEO', 'LEADER', 'WORKER', 'ASSISTANT', 'OBSERVER');

-- CreateEnum
CREATE TYPE "OrgPositionStatus" AS ENUM ('OPEN', 'BOUND', 'DISABLED');

-- CreateEnum
CREATE TYPE "PlanningEngine" AS ENUM ('mock', 'pddl', 'htn', 'bpmn', 'temporal', 'unknown', 'soft');

-- CreateEnum
CREATE TYPE "PlanningRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('RUNNING', 'WAITING', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowWaitReason" AS ENUM ('CONTINUATION', 'USER_INPUT', 'APPROVAL', 'EXTERNAL_DEPENDENCY', 'RESOURCE_CONFLICT');

-- CreateEnum
CREATE TYPE "WorkflowContinuationMode" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "WorkflowPhaseStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'BLOCKED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowTurnTrigger" AS ENUM ('USER', 'AUTO', 'RESUME', 'RECOVERY');

-- CreateEnum
CREATE TYPE "RuntimePermissionMode" AS ENUM ('confirm_required', 'audit_autorun', 'full_access');

-- CreateEnum
CREATE TYPE "RuntimeApprovalScopeType" AS ENUM ('TURN', 'WORKFLOW');

-- CreateEnum
CREATE TYPE "RuntimeRiskLevel" AS ENUM ('low', 'medium', 'high', 'forbidden');

-- CreateTable
CREATE TABLE "User" (
    "user_id" TEXT NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "phone" TEXT,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret" TEXT,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "account_locked_until" TIMESTAMP(3),
    "preferred_language" TEXT,
    "nickname" VARCHAR(50) DEFAULT '',
    "bio" VARCHAR(500) DEFAULT '',
    "avatarKey" VARCHAR(255),
    "avatarUpdatedAt" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "last_login_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "mcp_globally_enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "User_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "local_account" (
    "key" VARCHAR(32) NOT NULL DEFAULT 'primary',
    "user_id" TEXT,
    "session_id" VARCHAR(36),
    "refresh_token_hash" VARCHAR(64),
    "refresh_token_expires_at" TIMESTAMP(3),
    "initialized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_account_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entity_type" "SeekmoreEntityType" NOT NULL DEFAULT 'COGNITIVE',
    "visibility" "AgentVisibility" NOT NULL DEFAULT 'PRIVATE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "approved" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "purge_after" TIMESTAMP(3),
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "avatarKey" VARCHAR(255),
    "avatarUpdatedAt" TIMESTAMP(3),
    "coverKey" VARCHAR(255),
    "coverUpdatedAt" TIMESTAMP(3),
    "userId" TEXT,
    "key" TEXT,
    "systemPrompt" TEXT NOT NULL DEFAULT '',
    "role_prompt" TEXT,
    "isSuper" BOOLEAN NOT NULL DEFAULT false,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "capability_profile" JSONB,
    "capability_json" JSONB,
    "knowledge_enabled" BOOLEAN NOT NULL DEFAULT true,
    "memory_enabled" BOOLEAN NOT NULL DEFAULT true,
    "tool_enabled" BOOLEAN NOT NULL DEFAULT true,
    "runtime_profile_id" VARCHAR(120),
    "published_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "default_image_provider_id" VARCHAR(120),
    "default_voice_provider_id" VARCHAR(120),
    "risk_level" TEXT DEFAULT 'medium',
    "llmTemperature" DOUBLE PRECISION,
    "llmExtra" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_fact" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "org_id" TEXT,
    "group_id" TEXT,
    "plan_id" TEXT,
    "project_id" TEXT,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "conversation_id" TEXT,
    "scope_level" VARCHAR(32) NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "subject" VARCHAR(240) NOT NULL,
    "predicate" VARCHAR(160) NOT NULL,
    "value_json" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "search_text" TEXT NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stability" VARCHAR(32) NOT NULL,
    "sensitivity" VARCHAR(32) NOT NULL DEFAULT 'normal',
    "evidence_source" VARCHAR(64) NOT NULL,
    "source_conversation_id" TEXT,
    "source_message_id" TEXT,
    "source_assistant_message_id" TEXT,
    "source_trace_id" VARCHAR(128),
    "source_quote" TEXT,
    "source_hash" VARCHAR(128),
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_episode" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "org_id" TEXT,
    "group_id" TEXT,
    "plan_id" TEXT,
    "project_id" TEXT,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "conversation_id" TEXT,
    "source_conversation_id" TEXT,
    "source_user_message_id" TEXT,
    "source_assistant_message_id" TEXT,
    "source_trace_id" VARCHAR(128),
    "user_text" TEXT,
    "assistant_text" TEXT,
    "summary" TEXT,
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_relation" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "org_id" TEXT,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "from_memory_id" TEXT NOT NULL,
    "to_memory_id" TEXT NOT NULL,
    "relation_kind" VARCHAR(64) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_relation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_embedding" (
    "id" TEXT NOT NULL,
    "memory_id" TEXT NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "vector_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_embedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_audit" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "org_id" TEXT,
    "group_id" TEXT,
    "plan_id" TEXT,
    "project_id" TEXT,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "conversation_id" TEXT,
    "action" VARCHAR(64) NOT NULL,
    "memory_id" TEXT,
    "payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAgent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "accessLevel" "AgentAccessLevel" NOT NULL DEFAULT 'OWNER',
    "remark" TEXT,
    "pinnedAt" TIMESTAMP(3),
    "removed_from_chat_at" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "is_default_agent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_knowledge_object" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "stored_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "extension" VARCHAR(32),
    "size_bytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64),
    "storage_key" VARCHAR(500) NOT NULL,
    "parse_status" "KnowledgeParseStatus" NOT NULL DEFAULT 'PENDING',
    "parse_error" TEXT,
    "chunk_count" INTEGER,
    "embedding_model" VARCHAR(120),
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "agent_knowledge_object_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_knowledge_chunk" (
    "id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "token_count" INTEGER,
    "embedding" vector,
    "embedding_model" VARCHAR(120),
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_knowledge_chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runtime_object" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "origin_agent_id" TEXT NOT NULL,
    "origin_conversation_id" TEXT NOT NULL,
    "original_name" VARCHAR(500) NOT NULL,
    "display_name" VARCHAR(500) NOT NULL,
    "base_name" VARCHAR(500) NOT NULL,
    "extension" VARCHAR(64) NOT NULL DEFAULT '',
    "mime_type" VARCHAR(160) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "duplicate_group_key" VARCHAR(512) NOT NULL,
    "version_no" INTEGER NOT NULL DEFAULT 0,
    "storage_key" VARCHAR(1000) NOT NULL,
    "object_kind" VARCHAR(32) NOT NULL,
    "origin_type" VARCHAR(32) NOT NULL,
    "visibility" VARCHAR(32) NOT NULL,
    "upload_status" VARCHAR(32) NOT NULL DEFAULT 'available',
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "runtime_object_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_deletion_task" (
    "id" TEXT NOT NULL,
    "deduplication_key" VARCHAR(64) NOT NULL,
    "storage_kind" VARCHAR(32) NOT NULL,
    "storage_key" VARCHAR(1000) NOT NULL,
    "source_type" VARCHAR(64) NOT NULL,
    "source_id" VARCHAR(180) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_deletion_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_object_link" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "role" "MessageObjectRole" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_object_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_project_profile" (
    "id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "conversation_id" TEXT,
    "version_no" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "project_kind" VARCHAR(64) NOT NULL,
    "language_set_json" JSONB NOT NULL,
    "object_count" INTEGER NOT NULL DEFAULT 0,
    "indexed_object_count" INTEGER NOT NULL DEFAULT 0,
    "ignored_object_count" INTEGER NOT NULL DEFAULT 0,
    "structure_json" JSONB NOT NULL,
    "dependency_graph_json" JSONB,
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_project_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_project_object" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "object_id" TEXT,
    "path" VARCHAR(1000) NOT NULL,
    "language" VARCHAR(64) NOT NULL,
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "line_count" INTEGER NOT NULL DEFAULT 0,
    "hash" VARCHAR(64),
    "role" VARCHAR(32) NOT NULL DEFAULT 'source',
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_project_object_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_symbol" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "project_object_id" TEXT NOT NULL,
    "object_path" VARCHAR(1000) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "line_start" INTEGER NOT NULL,
    "line_end" INTEGER NOT NULL,
    "exported" BOOLEAN NOT NULL DEFAULT false,
    "signature" TEXT,
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_symbol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_patch_run" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "conversation_id" TEXT,
    "message_id" TEXT,
    "project_id" TEXT NOT NULL,
    "source_object_id" TEXT,
    "instruction" TEXT NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'planned',
    "patch_plan_json" JSONB NOT NULL,
    "applied_changes_json" JSONB,
    "validation_json" JSONB,
    "package_artifact_id" TEXT,
    "error_code" VARCHAR(120),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "code_patch_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_artifact" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "conversation_id" TEXT,
    "message_id" TEXT,
    "source_object_id" TEXT,
    "source_project_id" TEXT,
    "objectname" VARCHAR(500) NOT NULL,
    "storage_key" VARCHAR(1000) NOT NULL,
    "public_url" VARCHAR(1000),
    "mime_type" VARCHAR(160) NOT NULL DEFAULT 'application/zip',
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "package_kind" VARCHAR(32) NOT NULL DEFAULT 'zip',
    "status" VARCHAR(32) NOT NULL DEFAULT 'created',
    "manifest_json" JSONB NOT NULL,
    "validation_json" JSONB,
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_artifact_entry" (
    "id" TEXT NOT NULL,
    "package_artifact_id" TEXT NOT NULL,
    "path" VARCHAR(1000) NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "hash" VARCHAR(64),
    "action" VARCHAR(32),
    "source_path" VARCHAR(1000),
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_artifact_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "namespace_key" VARCHAR(240) NOT NULL,
    "tenant_id" VARCHAR(120),
    "organization_id" VARCHAR(120),
    "name" VARCHAR(120) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "description" VARCHAR(1024) NOT NULL,
    "activation_description" VARCHAR(1024) NOT NULL,
    "status" "SkillStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "SkillVisibility" NOT NULL DEFAULT 'PRIVATE',
    "trust_level" "SkillTrustLevel" NOT NULL DEFAULT 'USER',
    "security_state" "SkillSecurityState" NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "default_activation_mode" "SkillActivationMode" NOT NULL DEFAULT 'AUTOMATIC',
    "category" VARCHAR(80),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "icon_key" VARCHAR(500),
    "cover_key" VARCHAR(500),
    "current_version_id" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "use_count" BIGINT NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "last_validated_at" TIMESTAMP(3),
    "stale_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "quarantined_at" TIMESTAMP(3),
    "quarantine_reason" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "grow_enabled" BOOLEAN NOT NULL DEFAULT true,
    "grow_locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "purge_after" TIMESTAMP(3),

    CONSTRAINT "skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_source" (
    "id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "kind" "SkillSourceKind" NOT NULL,
    "source_ref" VARCHAR(1000),
    "source_revision" VARCHAR(240),
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "lock_data" JSONB NOT NULL DEFAULT '{}',
    "checksum" VARCHAR(128),
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_version" (
    "id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "version_label" VARCHAR(32) NOT NULL,
    "status" "SkillVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "skill_markdown" TEXT NOT NULL,
    "instruction_body" TEXT NOT NULL,
    "manifest" JSONB NOT NULL DEFAULT '{}',
    "compatibility" VARCHAR(500),
    "validation_policy" JSONB NOT NULL DEFAULT '{}',
    "failure_policy" JSONB NOT NULL DEFAULT '{}',
    "execution_policy" JSONB NOT NULL DEFAULT '{}',
    "package_checksum" VARCHAR(128) NOT NULL,
    "source_revision" VARCHAR(240),
    "change_log" TEXT,
    "routing_profile" JSONB NOT NULL DEFAULT '{}',
    "grow_provenance" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "skill_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_file" (
    "id" TEXT NOT NULL,
    "skill_version_id" TEXT NOT NULL,
    "path" VARCHAR(500) NOT NULL,
    "file_type" "SkillFileType" NOT NULL,
    "mime_type" VARCHAR(160) NOT NULL,
    "storage_key" VARCHAR(1000),
    "text_content" TEXT,
    "checksum" VARCHAR(128) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "executable" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_config_schema" (
    "id" TEXT NOT NULL,
    "skill_version_id" TEXT NOT NULL,
    "kind" "SkillSchemaKind" NOT NULL,
    "schema" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_config_schema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_dependency" (
    "id" TEXT NOT NULL,
    "skill_version_id" TEXT NOT NULL,
    "dependency_skill_id" TEXT NOT NULL,
    "version_constraint" VARCHAR(120),
    "required" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_dependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_tool_binding" (
    "id" TEXT NOT NULL,
    "skill_version_id" TEXT NOT NULL,
    "tool_name" VARCHAR(160) NOT NULL,
    "version_constraint" VARCHAR(120),
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT true,
    "config_schema" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_tool_binding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_mcp_binding" (
    "id" TEXT NOT NULL,
    "skill_version_id" TEXT NOT NULL,
    "mcp_server_id" TEXT,
    "server_name" VARCHAR(160) NOT NULL,
    "tool_name" VARCHAR(160),
    "capability" VARCHAR(160),
    "required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_mcp_binding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cognitive_agent_skill_policy" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "default_activation_mode" "SkillActivationMode" NOT NULL DEFAULT 'AUTOMATIC',
    "max_catalog_entries" INTEGER NOT NULL DEFAULT 40,
    "catalog_char_budget" INTEGER NOT NULL DEFAULT 8000,
    "instruction_token_budget" INTEGER NOT NULL DEFAULT 6000,
    "resource_token_budget" INTEGER NOT NULL DEFAULT 12000,
    "max_automatic_skills" INTEGER NOT NULL DEFAULT 2,
    "max_resource_files" INTEGER NOT NULL DEFAULT 5,
    "public_discovery_enabled" BOOLEAN NOT NULL DEFAULT true,
    "public_catalog_limit" INTEGER NOT NULL DEFAULT 12,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cognitive_agent_skill_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cognitive_agent_skill_binding" (
    "id" TEXT NOT NULL,
    "cognitive_agent_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "activation_mode" "SkillActivationMode",
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version_policy" "SkillVersionPolicy" NOT NULL DEFAULT 'FOLLOW_CURRENT',
    "version_constraint" VARCHAR(120),
    "pinned_version_id" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "permission_overrides" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cognitive_agent_skill_binding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_installation" (
    "id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "scope_type" "SkillPrincipalType" NOT NULL,
    "scope_id" VARCHAR(240) NOT NULL,
    "installed_by_user_id" TEXT NOT NULL,
    "pinned_version_id" TEXT,
    "status" "SkillInstallationStatus" NOT NULL DEFAULT 'INSTALLED',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "skill_installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_skill_activation" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "activationMode" "SkillActivationMode" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL DEFAULT '{}',
    "selected_version_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_skill_activation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_acl_entry" (
    "id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "principal_type" "SkillPrincipalType" NOT NULL,
    "principal_id" VARCHAR(240) NOT NULL,
    "permissions" "SkillPermissionAction"[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_acl_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_validation_run" (
    "id" TEXT NOT NULL,
    "skill_version_id" TEXT NOT NULL,
    "status" "SkillValidationStatus" NOT NULL DEFAULT 'PENDING',
    "scanner_version" VARCHAR(120) NOT NULL,
    "package_checksum" VARCHAR(128) NOT NULL,
    "structural_result" JSONB NOT NULL DEFAULT '{}',
    "security_result" JSONB NOT NULL DEFAULT '{}',
    "dependency_result" JSONB NOT NULL DEFAULT '{}',
    "diagnostics" JSONB NOT NULL DEFAULT '[]',
    "requested_by_user_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_validation_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_usage_event" (
    "id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "skill_version_id" TEXT NOT NULL,
    "user_id" TEXT,
    "agent_id" TEXT,
    "conversation_id" TEXT,
    "trace_id" VARCHAR(128),
    "turn_id" VARCHAR(128),
    "activationMode" "SkillActivationMode" NOT NULL,
    "activationSource" "SkillActivationSource" NOT NULL,
    "outcome" "SkillUsageOutcome" NOT NULL,
    "reason" TEXT,
    "confidence" DOUBLE PRECISION,
    "token_estimate" INTEGER,
    "duration_ms" INTEGER,
    "dependency_status" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_usage_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_audit_log" (
    "id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "skill_version_id" TEXT,
    "actor_user_id" TEXT,
    "event_type" VARCHAR(120) NOT NULL,
    "severity" VARCHAR(32) NOT NULL DEFAULT 'info',
    "trace_id" VARCHAR(128),
    "before_data" JSONB,
    "after_data" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grow_observer_state" (
    "id" TEXT NOT NULL,
    "user_id" VARCHAR(120) NOT NULL,
    "agent_id" VARCHAR(120) NOT NULL,
    "tool_iterations_since_review" INTEGER NOT NULL DEFAULT 0,
    "last_review_at" TIMESTAMP(3),
    "last_reviewed_turn_id" VARCHAR(180),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grow_observer_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grow_review" (
    "id" TEXT NOT NULL,
    "event_id" VARCHAR(180) NOT NULL,
    "trigger_turn_id" VARCHAR(180) NOT NULL,
    "trigger_trace_id" VARCHAR(180) NOT NULL,
    "user_id" VARCHAR(120) NOT NULL,
    "agent_id" VARCHAR(120) NOT NULL,
    "conversation_id" VARCHAR(120) NOT NULL,
    "trigger_type" "GrowTriggerType" NOT NULL,
    "status" "GrowReviewStatus" NOT NULL DEFAULT 'PENDING',
    "evidence_json" JSONB NOT NULL DEFAULT '[]',
    "focus_result_json" JSONB,
    "created_draft_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "published_version_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rejected_version_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error_json" JSONB,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_by" VARCHAR(180),
    "claim_expires_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grow_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grow_effect_observation" (
    "id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "skill_version_id" TEXT NOT NULL,
    "previous_version_id" TEXT,
    "review_id" TEXT NOT NULL,
    "user_id" VARCHAR(120) NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "completed_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "rejected_count" INTEGER NOT NULL DEFAULT 0,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "total_observed" INTEGER NOT NULL DEFAULT 0,
    "rolled_back_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grow_effect_observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grow_effect_event_receipt" (
    "id" TEXT NOT NULL,
    "event_id" VARCHAR(180) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grow_effect_event_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cognitive_agent_profile" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "writing_profile" JSONB,
    "reasoning_policy" JSONB,
    "artifact_policy" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cognitive_agent_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_agent_profile" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "merchant_profile" JSONB,
    "order_policy" JSONB,
    "risk_policy" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_agent_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "titleUpdatedAt" TIMESTAMP(3),
    "titleVersion" INTEGER NOT NULL DEFAULT 1,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "current_leaf_message_id" TEXT,
    "parent_conversation_id" TEXT,
    "branch_from_message_id" TEXT,
    "branch_request_id" TEXT,
    "endpoint" VARCHAR(80),
    "model" VARCHAR(120),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_temporary" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "purge_after" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "meta" JSONB DEFAULT '{}',

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_runtime_setting" (
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "permission_mode" "RuntimePermissionMode" NOT NULL DEFAULT 'confirm_required',
    "format_locale" TEXT,
    "time_zone" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_runtime_setting_pkey" PRIMARY KEY ("conversation_id")
);

-- CreateTable
CREATE TABLE "automation" (
    "id" TEXT NOT NULL,
    "user_id" VARCHAR(120) NOT NULL,
    "agent_id" VARCHAR(120) NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "anchor_message_id" VARCHAR(180),
    "title" VARCHAR(240) NOT NULL,
    "instruction" TEXT NOT NULL,
    "trigger" JSONB NOT NULL,
    "stop_policy" JSONB NOT NULL,
    "delivery_policy" JSONB NOT NULL,
    "status" "AutomationStatus" NOT NULL DEFAULT 'ACTIVE',
    "next_wake_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "completion_reason" VARCHAR(80),
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" VARCHAR(32),
    "cancel_reason" VARCHAR(240),
    "expiry_notice_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_run" (
    "id" TEXT NOT NULL,
    "automation_id" TEXT NOT NULL,
    "trace_id" VARCHAR(180),
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'PENDING',
    "user_message_id" VARCHAR(180),
    "assistant_message_id" VARCHAR(180),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_code" VARCHAR(120),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatTurnRequest" (
    "id" TEXT NOT NULL,
    "clientMessageId" TEXT NOT NULL,
    "traceId" TEXT,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sequence" BIGINT NOT NULL,
    "status" "ChatTurnRequestStatus" NOT NULL DEFAULT 'QUEUED',
    "cleanupStatus" "ChatTurnCleanupStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "payload" JSONB NOT NULL,
    "userMessageId" TEXT,
    "assistantMessageId" TEXT,
    "cancelReason" TEXT,
    "cancelRequestedAt" TIMESTAMP(3),
    "cleanupRequestedAt" TIMESTAMP(3),
    "cleanupCompletedAt" TIMESTAMP(3),
    "cleanupDiagnostics" JSONB,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatTurnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationDigest" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT,
    "topicKey" TEXT,
    "digestText" TEXT NOT NULL,
    "messageFromId" TEXT,
    "messageToId" TEXT,
    "sourceTurnIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "staleScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationDigest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "parent_message_id" TEXT,
    "root_message_id" TEXT,
    "branch_id" TEXT,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "content_parts" JSONB,
    "trace_id" VARCHAR(128),
    "sender_type" VARCHAR(16),
    "sender_user_id" TEXT,
    "sender_agent_id" TEXT,
    "model" VARCHAR(120),
    "endpoint" VARCHAR(80),
    "token_count" INTEGER,
    "summary" TEXT,
    "summary_token_count" INTEGER,
    "status" VARCHAR(32) NOT NULL DEFAULT 'finished',
    "unfinished" BOOLEAN NOT NULL DEFAULT false,
    "error" BOOLEAN NOT NULL DEFAULT false,
    "finish_reason" VARCHAR(80),
    "citations" JSONB,
    "meta" JSONB DEFAULT '{}',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserLlmCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerKey" VARCHAR(64) NOT NULL,
    "apiKey" TEXT NOT NULL,
    "keyHint" VARCHAR(16),
    "status" "LlmCredentialStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "lastValidationCode" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserLlmCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserLlmPreference" (
    "userId" TEXT NOT NULL,
    "providerKey" VARCHAR(64) NOT NULL,
    "modelKey" VARCHAR(160) NOT NULL,
    "visionProviderKey" VARCHAR(64),
    "visionModelKey" VARCHAR(160),
    "imageProviderKey" VARCHAR(64),
    "imageModelKey" VARCHAR(160),
    "audioProviderKey" VARCHAR(64),
    "videoProviderKey" VARCHAR(64),
    "videoModelKey" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserLlmPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "UserVoiceAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerKey" VARCHAR(64) NOT NULL,
    "externalVoiceId" VARCHAR(256) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "sourceObjectId" VARCHAR(64),
    "consentVersion" VARCHAR(32) NOT NULL,
    "requiresVerification" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(32) NOT NULL DEFAULT 'ready',
    "statusReason" VARCHAR(120),
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "UserVoiceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWebSearchSetting" (
    "userId" TEXT NOT NULL,
    "providerKey" VARCHAR(64) NOT NULL,
    "apiKey" TEXT NOT NULL,
    "keyHint" VARCHAR(16),
    "status" "LlmCredentialStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "lastValidationCode" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserWebSearchSetting_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "runtime_workspace" (
    "id" TEXT NOT NULL,
    "workspace_key" VARCHAR(180) NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "conversation_id" TEXT,
    "state_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "runtime_workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpServerConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stable_key" TEXT,
    "source" TEXT NOT NULL DEFAULT 'USER',
    "owner_user_id" TEXT,
    "displayName" TEXT,
    "description" TEXT,
    "publisher" TEXT,
    "icon_key" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "review_status" TEXT NOT NULL DEFAULT 'pending',
    "origin_type" TEXT NOT NULL DEFAULT 'FORM',
    "registry_identifier" TEXT,
    "registry_version" TEXT,
    "repository" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "protocol_preference" TEXT NOT NULL DEFAULT 'auto',
    "managed_runtime" TEXT NOT NULL DEFAULT 'REMOTE',
    "transport" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'enabled',
    "trustLevel" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "endpoint" TEXT,
    "command" TEXT,
    "args" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "working_directory" TEXT,
    "env" JSONB NOT NULL DEFAULT '{}',
    "headers" JSONB NOT NULL DEFAULT '{}',
    "authKind" TEXT NOT NULL DEFAULT 'none',
    "authConfig" JSONB NOT NULL DEFAULT '{}',
    "allowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deniedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedToolNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deniedToolNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tool_policy" JSONB NOT NULL DEFAULT '{}',
    "requestScoped" BOOLEAN NOT NULL DEFAULT false,
    "timeoutMs" INTEGER,
    "tenantId" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpServerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpInstallation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'installed',
    "configuration_state" TEXT NOT NULL DEFAULT 'ready',
    "allowed_tool_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "denied_tool_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpCredential" (
    "id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storage_location" TEXT NOT NULL,
    "encrypted_payload" BYTEA,
    "encryption_iv" BYTEA,
    "auth_tag" BYTEA,
    "secret_ref" TEXT,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "masked_hint" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpAuthSession" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "tenantId" TEXT DEFAULT '',
    "userId" TEXT NOT NULL,
    "agentId" TEXT DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "authKind" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "encrypted_payload" BYTEA,
    "encryption_iv" BYTEA,
    "auth_tag" BYTEA,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "tokenType" TEXT,
    "scope" TEXT,
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpAuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpOAuthState" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "agentId" TEXT,
    "state" TEXT NOT NULL,
    "codeVerifier" TEXT,
    "encrypted_code_verifier" BYTEA,
    "code_verifier_iv" BYTEA,
    "code_verifier_auth_tag" BYTEA,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "redirectUri" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpConnectionState" (
    "id" TEXT NOT NULL,
    "identityHash" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "installation_id" TEXT,
    "tenantId" TEXT,
    "userId" TEXT,
    "agentId" TEXT,
    "authSessionId" TEXT,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "protocol_era" TEXT,
    "protocol_version" TEXT,
    "lastConnectedAt" TIMESTAMP(3),
    "lastDisconnectedAt" TIMESTAMP(3),
    "lastHealthCheckAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpConnectionState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpToolSnapshot" (
    "id" TEXT NOT NULL,
    "runtimeToolId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "installation_id" TEXT,
    "serverName" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "inputSchema" JSONB NOT NULL DEFAULT '{}',
    "outputSchema" JSONB,
    "annotations" JSONB,
    "snapshotHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpToolSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpToolInvocation" (
    "id" TEXT NOT NULL,
    "runtimeToolId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "installation_id" TEXT,
    "toolSnapshotId" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "agentId" TEXT,
    "conversation_id" TEXT,
    "turn_id" TEXT,
    "workflow_id" TEXT,
    "step_id" TEXT,
    "request_id" TEXT,
    "traceId" TEXT,
    "status" TEXT NOT NULL,
    "arguments" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "McpToolInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpAuditLog" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "serverId" TEXT,
    "runtimeToolId" TEXT,
    "tenantId" TEXT,
    "userId" TEXT,
    "agentId" TEXT,
    "traceId" TEXT,
    "severity" TEXT NOT NULL,
    "code" TEXT,
    "message" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComputerUseSession" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT,
    "agentId" TEXT,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT,
    "traceId" TEXT,
    "status" TEXT NOT NULL,
    "adapterKind" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "userText" TEXT NOT NULL,
    "goalJson" JSONB NOT NULL,
    "stepsJson" JSONB NOT NULL,
    "completedJson" JSONB NOT NULL,
    "pendingJson" JSONB,
    "resumeTokenHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComputerUseSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComputerUseStepRun" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "adapterKind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "inputJson" JSONB NOT NULL,
    "outputJson" JSONB,
    "observation" TEXT,
    "errorJson" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComputerUseStepRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComputerUseCheckpoint" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stepId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "observationJson" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComputerUseCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComputerUseSkillTrace" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "host" TEXT NOT NULL,
    "taskPattern" TEXT NOT NULL,
    "pageFingerprint" TEXT,
    "stepsJson" JSONB NOT NULL,
    "selectorHints" JSONB,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "avgDurationMs" INTEGER,
    "lastUsedAt" TIMESTAMP(3),
    "traceKind" TEXT NOT NULL DEFAULT 'browser',
    "traceVersion" INTEGER NOT NULL DEFAULT 1,
    "normalizerVersion" INTEGER NOT NULL DEFAULT 1,
    "slotSignature" TEXT,
    "goalVerifier" JSONB,
    "traceContract" JSONB,
    "qualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "repairCount" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComputerUseSkillTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runtime_event_outbox" (
    "id" TEXT NOT NULL,
    "event_id" VARCHAR(180) NOT NULL,
    "event_type" VARCHAR(160) NOT NULL,
    "aggregate_type" VARCHAR(80) NOT NULL,
    "aggregate_id" VARCHAR(180) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "deduplication_key" VARCHAR(300) NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_by" VARCHAR(180),
    "claim_expires_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runtime_event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runtime_timeline_event" (
    "id" TEXT NOT NULL,
    "event_id" VARCHAR(180) NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "presentation_message_id" VARCHAR(180) NOT NULL,
    "source_assistant_message_id" VARCHAR(180),
    "trace_id" VARCHAR(180),
    "workflow_id" VARCHAR(180),
    "identity_key" VARCHAR(260) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sequence" BIGSERIAL NOT NULL,
    "type" VARCHAR(120) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runtime_timeline_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_run" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "branch_id" VARCHAR(180),
    "workspace_id" TEXT,
    "initial_user_message_id" VARCHAR(180) NOT NULL,
    "input_object_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "title" VARCHAR(256) NOT NULL,
    "goal" TEXT NOT NULL,
    "contract_json" JSONB NOT NULL DEFAULT '{}',
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'RUNNING',
    "wait_reason" "WorkflowWaitReason",
    "continuation_mode" "WorkflowContinuationMode" NOT NULL DEFAULT 'MANUAL',
    "permission_mode" "RuntimePermissionMode" NOT NULL DEFAULT 'confirm_required',
    "current_phase_id" VARCHAR(180),
    "lease_owner" VARCHAR(180),
    "lease_expires_at" TIMESTAMP(3),
    "fencing_token" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "workflow_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_phase" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "parent_phase_id" TEXT,
    "title" VARCHAR(256) NOT NULL,
    "description" TEXT,
    "status" "WorkflowPhaseStatus" NOT NULL DEFAULT 'PENDING',
    "position" INTEGER NOT NULL,
    "dependency_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acceptance_json" JSONB,
    "result_summary" TEXT,
    "result_json" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_phase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_turn_link" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "phase_id" TEXT,
    "trace_id" VARCHAR(180) NOT NULL,
    "user_message_id" VARCHAR(180),
    "assistant_message_id" VARCHAR(180),
    "trigger" "WorkflowTurnTrigger" NOT NULL DEFAULT 'USER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_turn_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_event" (
    "id" TEXT NOT NULL,
    "event_id" VARCHAR(180) NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "phase_id" TEXT,
    "sequence" INTEGER NOT NULL,
    "type" VARCHAR(160) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "deduplication_key" VARCHAR(300) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_turn" (
    "id" TEXT NOT NULL,
    "trace_id" VARCHAR(180) NOT NULL,
    "user_id" VARCHAR(120) NOT NULL,
    "agent_id" VARCHAR(120) NOT NULL,
    "conversation_id" VARCHAR(120) NOT NULL,
    "user_message_id" VARCHAR(180) NOT NULL,
    "assistant_message_id" VARCHAR(180) NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'running',
    "kernel_session_id" VARCHAR(180) NOT NULL,
    "workspace_id" TEXT,
    "permission_mode" "RuntimePermissionMode" NOT NULL DEFAULT 'confirm_required',
    "access_policy_version" INTEGER NOT NULL DEFAULT 1,
    "request_json" JSONB,
    "result_json" JSONB,
    "error_json" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_turn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_turn_checkpoint" (
    "id" TEXT NOT NULL,
    "turn_id" TEXT NOT NULL,
    "state_json" JSONB NOT NULL,
    "pending_tool_call_id" VARCHAR(180),
    "pending_approval_id" VARCHAR(180),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_turn_checkpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_approval" (
    "id" TEXT NOT NULL,
    "approval_id" VARCHAR(180) NOT NULL,
    "turn_id" TEXT NOT NULL,
    "trace_id" VARCHAR(180) NOT NULL,
    "user_id" VARCHAR(120) NOT NULL,
    "agent_id" VARCHAR(120) NOT NULL,
    "conversation_id" VARCHAR(120) NOT NULL,
    "assistant_message_id" VARCHAR(180) NOT NULL,
    "tool_call_id" VARCHAR(180),
    "tool_name" VARCHAR(180) NOT NULL,
    "scope_type" "RuntimeApprovalScopeType" NOT NULL,
    "scope_id" VARCHAR(180) NOT NULL,
    "workflow_id" VARCHAR(180),
    "phase_id" VARCHAR(180),
    "step_id" VARCHAR(180),
    "iteration" INTEGER,
    "risk_level" "RuntimeRiskLevel" NOT NULL,
    "descriptor_hash" VARCHAR(128) NOT NULL,
    "policy_version_at_request" INTEGER NOT NULL,
    "permission_mode" "RuntimePermissionMode" NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'pending',
    "decision" VARCHAR(40),
    "request_json" JSONB NOT NULL,
    "error_json" JSONB,
    "decided_at" TIMESTAMP(3),
    "resumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_turn_input" (
    "id" TEXT NOT NULL,
    "turn_id" TEXT NOT NULL,
    "client_input_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "content" TEXT NOT NULL,
    "object_refs" JSONB NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_turn_input_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_turn_event" (
    "id" TEXT NOT NULL,
    "turn_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" VARCHAR(80) NOT NULL,
    "iteration" INTEGER NOT NULL,
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_turn_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "idx_user_email" ON "User"("email");

-- CreateIndex
CREATE INDEX "idx_user_username" ON "User"("username");

-- CreateIndex
CREATE INDEX "idx_user_created_at" ON "User"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "local_account_user_id_key" ON "local_account"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_key_key" ON "Agent"("key");

-- CreateIndex
CREATE INDEX "Agent_userId_idx" ON "Agent"("userId");

-- CreateIndex
CREATE INDEX "idx_agent_entity_type" ON "Agent"("entity_type");

-- CreateIndex
CREATE INDEX "Agent_visibility_approved_isActive_idx" ON "Agent"("visibility", "approved", "isActive");

-- CreateIndex
CREATE INDEX "idx_agent_published_at" ON "Agent"("published_at");

-- CreateIndex
CREATE INDEX "idx_agent_verified_at" ON "Agent"("verified_at");

-- CreateIndex
CREATE INDEX "Agent_deletedAt_idx" ON "Agent"("deletedAt");

-- CreateIndex
CREATE INDEX "idx_agent_purge_after" ON "Agent"("purge_after");

-- CreateIndex
CREATE INDEX "idx_memory_fact_user_status_scope_kind" ON "memory_fact"("user_id", "status", "scope_level", "kind");

-- CreateIndex
CREATE INDEX "idx_memory_fact_user_agent_status" ON "memory_fact"("user_id", "agent_id", "status");

-- CreateIndex
CREATE INDEX "idx_memory_fact_user_conversation_status" ON "memory_fact"("user_id", "conversation_id", "status");

-- CreateIndex
CREATE INDEX "idx_memory_fact_user_project_status" ON "memory_fact"("user_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "idx_memory_fact_tenant_org_user" ON "memory_fact"("tenant_id", "org_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_memory_fact_source_message" ON "memory_fact"("source_conversation_id", "source_message_id");

-- CreateIndex
CREATE INDEX "idx_memory_fact_source_hash" ON "memory_fact"("source_hash");

-- CreateIndex
CREATE INDEX "idx_memory_fact_status_updated" ON "memory_fact"("status", "updated_at");

-- CreateIndex
CREATE INDEX "idx_memory_episode_user_conversation_time" ON "memory_episode"("user_id", "conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_memory_episode_source_user_message" ON "memory_episode"("source_conversation_id", "source_user_message_id");

-- CreateIndex
CREATE INDEX "idx_memory_episode_tenant_org_user" ON "memory_episode"("tenant_id", "org_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_memory_episode_status_time" ON "memory_episode"("status", "created_at");

-- CreateIndex
CREATE INDEX "idx_memory_relation_user_from" ON "memory_relation"("user_id", "from_memory_id");

-- CreateIndex
CREATE INDEX "idx_memory_relation_user_to" ON "memory_relation"("user_id", "to_memory_id");

-- CreateIndex
CREATE INDEX "idx_memory_relation_project_kind" ON "memory_relation"("project_id", "relation_kind");

-- CreateIndex
CREATE INDEX "idx_memory_relation_status" ON "memory_relation"("status");

-- CreateIndex
CREATE INDEX "idx_memory_embedding_memory" ON "memory_embedding"("memory_id");

-- CreateIndex
CREATE INDEX "idx_memory_embedding_provider_model" ON "memory_embedding"("provider", "model");

-- CreateIndex
CREATE INDEX "idx_memory_audit_user_time" ON "memory_audit"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_memory_audit_memory" ON "memory_audit"("memory_id");

-- CreateIndex
CREATE INDEX "idx_memory_audit_action_time" ON "memory_audit"("action", "created_at");

-- CreateIndex
CREATE INDEX "idx_memory_audit_tenant_org_user" ON "memory_audit"("tenant_id", "org_id", "user_id");

-- CreateIndex
CREATE INDEX "UserAgent_userId_idx" ON "UserAgent"("userId");

-- CreateIndex
CREATE INDEX "UserAgent_agentId_idx" ON "UserAgent"("agentId");

-- CreateIndex
CREATE INDEX "UserAgent_pinnedAt_idx" ON "UserAgent"("pinnedAt");

-- CreateIndex
CREATE INDEX "idx_user_agent_removed_chat" ON "UserAgent"("removed_from_chat_at");

-- CreateIndex
CREATE INDEX "UserAgent_deletedAt_idx" ON "UserAgent"("deletedAt");

-- CreateIndex
CREATE INDEX "idx_user_default_agent" ON "UserAgent"("userId", "is_default_agent");

-- CreateIndex
CREATE UNIQUE INDEX "uq_agent_user" ON "UserAgent"("agentId", "userId");

-- CreateIndex
CREATE INDEX "idx_agent_knowledge_agent" ON "agent_knowledge_object"("agent_id");

-- CreateIndex
CREATE INDEX "idx_agent_knowledge_user" ON "agent_knowledge_object"("user_id");

-- CreateIndex
CREATE INDEX "idx_agent_knowledge_parse_status" ON "agent_knowledge_object"("parse_status");

-- CreateIndex
CREATE INDEX "idx_agent_knowledge_deleted_at" ON "agent_knowledge_object"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_agent_knowledge_chunk_object" ON "agent_knowledge_chunk"("object_id");

-- CreateIndex
CREATE INDEX "idx_agent_knowledge_chunk_agent" ON "agent_knowledge_chunk"("agent_id");

-- CreateIndex
CREATE INDEX "idx_agent_knowledge_chunk_user" ON "agent_knowledge_chunk"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_agent_knowledge_chunk_object_index" ON "agent_knowledge_chunk"("object_id", "chunk_index");

-- CreateIndex
CREATE INDEX "idx_runtime_object_user_extension_name" ON "runtime_object"("user_id", "extension", "base_name");

-- CreateIndex
CREATE INDEX "idx_runtime_object_partition_created" ON "runtime_object"("user_id", "origin_agent_id", "origin_conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_runtime_object_partition_kind" ON "runtime_object"("user_id", "origin_agent_id", "origin_conversation_id", "object_kind");

-- CreateIndex
CREATE INDEX "idx_runtime_object_partition_visibility_kind_created" ON "runtime_object"("user_id", "origin_agent_id", "origin_conversation_id", "visibility", "object_kind", "created_at");

-- CreateIndex
CREATE INDEX "idx_runtime_object_content_hash" ON "runtime_object"("content_hash");

-- CreateIndex
CREATE INDEX "idx_runtime_object_deleted_at" ON "runtime_object"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_runtime_object_partition_name_version" ON "runtime_object"("duplicate_group_key", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "storage_deletion_task_deduplication_key_key" ON "storage_deletion_task"("deduplication_key");

-- CreateIndex
CREATE INDEX "idx_storage_deletion_task_pending" ON "storage_deletion_task"("status", "available_at");

-- CreateIndex
CREATE INDEX "idx_storage_deletion_task_source" ON "storage_deletion_task"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "idx_storage_deletion_task_claimed" ON "storage_deletion_task"("claimed_at");

-- CreateIndex
CREATE INDEX "idx_message_object_link_message_role" ON "message_object_link"("message_id", "role");

-- CreateIndex
CREATE INDEX "idx_message_object_link_object" ON "message_object_link"("object_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_message_object_link_message_object_role" ON "message_object_link"("message_id", "object_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "uq_message_object_link_message_role_position" ON "message_object_link"("message_id", "role", "position");

-- CreateIndex
CREATE INDEX "idx_code_project_profile_object" ON "code_project_profile"("object_id");

-- CreateIndex
CREATE INDEX "idx_code_project_profile_object_active" ON "code_project_profile"("object_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "uq_code_project_profile_object_version" ON "code_project_profile"("object_id", "version_no");

-- CreateIndex
CREATE INDEX "idx_code_project_object_project" ON "code_project_object"("project_id");

-- CreateIndex
CREATE INDEX "idx_code_project_object_language" ON "code_project_object"("language");

-- CreateIndex
CREATE UNIQUE INDEX "uq_code_project_object_project_path" ON "code_project_object"("project_id", "path");

-- CreateIndex
CREATE INDEX "idx_code_symbol_project_name" ON "code_symbol"("project_id", "name");

-- CreateIndex
CREATE INDEX "idx_code_symbol_project_object_path" ON "code_symbol"("project_id", "object_path");

-- CreateIndex
CREATE INDEX "idx_code_symbol_project_object" ON "code_symbol"("project_object_id");

-- CreateIndex
CREATE INDEX "idx_code_symbol_kind" ON "code_symbol"("kind");

-- CreateIndex
CREATE INDEX "idx_code_patch_run_project" ON "code_patch_run"("project_id");

-- CreateIndex
CREATE INDEX "idx_code_patch_run_source_object" ON "code_patch_run"("source_object_id");

-- CreateIndex
CREATE INDEX "idx_code_patch_run_package_artifact" ON "code_patch_run"("package_artifact_id");

-- CreateIndex
CREATE INDEX "idx_code_patch_run_status" ON "code_patch_run"("status");

-- CreateIndex
CREATE INDEX "idx_package_artifact_source_object" ON "package_artifact"("source_object_id");

-- CreateIndex
CREATE INDEX "idx_package_artifact_source_project" ON "package_artifact"("source_project_id");

-- CreateIndex
CREATE INDEX "idx_package_artifact_status" ON "package_artifact"("status");

-- CreateIndex
CREATE INDEX "idx_package_artifact_entry_package" ON "package_artifact_entry"("package_artifact_id");

-- CreateIndex
CREATE INDEX "idx_package_artifact_entry_kind" ON "package_artifact_entry"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "skill_current_version_id_key" ON "skill"("current_version_id");

-- CreateIndex
CREATE INDEX "idx_skill_owner_status" ON "skill"("owner_user_id", "status");

-- CreateIndex
CREATE INDEX "idx_skill_org_visibility_status" ON "skill"("organization_id", "visibility", "status");

-- CreateIndex
CREATE INDEX "idx_skill_tenant_status" ON "skill"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "idx_skill_trust_security" ON "skill"("trust_level", "security_state");

-- CreateIndex
CREATE INDEX "idx_skill_category" ON "skill"("category");

-- CreateIndex
CREATE INDEX "idx_skill_tags_gin" ON "skill" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "idx_skill_platforms_gin" ON "skill" USING GIN ("platforms");

-- CreateIndex
CREATE INDEX "idx_skill_last_used" ON "skill"("last_used_at");

-- CreateIndex
CREATE INDEX "idx_skill_deleted" ON "skill"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_skill_purge_after" ON "skill"("purge_after");

-- CreateIndex
CREATE UNIQUE INDEX "uq_skill_namespace_slug" ON "skill"("namespace_key", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "skill_source_skill_id_key" ON "skill_source"("skill_id");

-- CreateIndex
CREATE INDEX "idx_skill_source_kind_revision" ON "skill_source"("kind", "source_revision");

-- CreateIndex
CREATE INDEX "idx_skill_version_status" ON "skill_version"("skill_id", "status");

-- CreateIndex
CREATE INDEX "idx_skill_version_checksum" ON "skill_version"("package_checksum");

-- CreateIndex
CREATE INDEX "idx_skill_version_published" ON "skill_version"("published_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_skill_version_number" ON "skill_version"("skill_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "uq_skill_version_label" ON "skill_version"("skill_id", "version_label");

-- CreateIndex
CREATE INDEX "idx_skill_file_version_type" ON "skill_file"("skill_version_id", "file_type");

-- CreateIndex
CREATE INDEX "idx_skill_file_checksum" ON "skill_file"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX "uq_skill_file_version_path" ON "skill_file"("skill_version_id", "path");

-- CreateIndex
CREATE UNIQUE INDEX "uq_skill_config_schema" ON "skill_config_schema"("skill_version_id", "kind");

-- CreateIndex
CREATE INDEX "idx_skill_dependency_target" ON "skill_dependency"("dependency_skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_skill_dependency" ON "skill_dependency"("skill_version_id", "dependency_skill_id");

-- CreateIndex
CREATE INDEX "idx_skill_tool_name" ON "skill_tool_binding"("tool_name");

-- CreateIndex
CREATE UNIQUE INDEX "uq_skill_tool_binding" ON "skill_tool_binding"("skill_version_id", "tool_name");

-- CreateIndex
CREATE INDEX "idx_skill_mcp_server" ON "skill_mcp_binding"("mcp_server_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_skill_mcp_binding" ON "skill_mcp_binding"("skill_version_id", "server_name", "tool_name");

-- CreateIndex
CREATE UNIQUE INDEX "cognitive_agent_skill_policy_agent_id_key" ON "cognitive_agent_skill_policy"("agent_id");

-- CreateIndex
CREATE INDEX "idx_agent_skill_effective" ON "cognitive_agent_skill_binding"("cognitive_agent_id", "enabled", "priority");

-- CreateIndex
CREATE INDEX "idx_agent_skill_skill" ON "cognitive_agent_skill_binding"("skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_cognitive_agent_skill" ON "cognitive_agent_skill_binding"("cognitive_agent_id", "skill_id");

-- CreateIndex
CREATE INDEX "idx_skill_installation_status" ON "skill_installation"("skill_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_skill_installation_scope" ON "skill_installation"("scope_type", "scope_id", "skill_id");

-- CreateIndex
CREATE INDEX "idx_conversation_skill_enabled" ON "conversation_skill_activation"("conversation_id", "enabled");

-- CreateIndex
CREATE INDEX "idx_conversation_skill_expiry" ON "conversation_skill_activation"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_conversation_skill" ON "conversation_skill_activation"("conversation_id", "skill_id");

-- CreateIndex
CREATE INDEX "idx_skill_acl_lookup" ON "skill_acl_entry"("principal_type", "principal_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_skill_acl_principal" ON "skill_acl_entry"("skill_id", "principal_type", "principal_id");

-- CreateIndex
CREATE INDEX "idx_skill_validation_status" ON "skill_validation_run"("skill_version_id", "status");

-- CreateIndex
CREATE INDEX "idx_skill_usage_skill_time" ON "skill_usage_event"("skill_id", "occurred_at");

-- CreateIndex
CREATE INDEX "idx_skill_usage_agent_time" ON "skill_usage_event"("agent_id", "occurred_at");

-- CreateIndex
CREATE INDEX "idx_skill_usage_conversation" ON "skill_usage_event"("conversation_id", "occurred_at");

-- CreateIndex
CREATE INDEX "idx_skill_usage_trace" ON "skill_usage_event"("trace_id");

-- CreateIndex
CREATE INDEX "idx_skill_audit_skill_time" ON "skill_audit_log"("skill_id", "occurred_at");

-- CreateIndex
CREATE INDEX "idx_skill_audit_event_time" ON "skill_audit_log"("event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "idx_skill_audit_trace" ON "skill_audit_log"("trace_id");

-- CreateIndex
CREATE INDEX "idx_grow_observer_last_review" ON "grow_observer_state"("last_review_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_grow_observer_user_agent" ON "grow_observer_state"("user_id", "agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "grow_review_event_id_key" ON "grow_review"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "grow_review_trigger_turn_id_key" ON "grow_review"("trigger_turn_id");

-- CreateIndex
CREATE INDEX "idx_grow_review_pending" ON "grow_review"("status", "available_at");

-- CreateIndex
CREATE INDEX "idx_grow_review_user_time" ON "grow_review"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_grow_review_agent_time" ON "grow_review"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_grow_review_claim_expiry" ON "grow_review"("claim_expires_at");

-- CreateIndex
CREATE INDEX "idx_grow_effect_user_open" ON "grow_effect_observation"("user_id", "closed_at");

-- CreateIndex
CREATE INDEX "idx_grow_effect_review" ON "grow_effect_observation"("review_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_grow_effect_skill_version" ON "grow_effect_observation"("skill_id", "skill_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "grow_effect_event_receipt_event_id_key" ON "grow_effect_event_receipt"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "cognitive_agent_profile_agent_id_key" ON "cognitive_agent_profile"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_agent_profile_agent_id_key" ON "service_agent_profile"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_branch_request_id_key" ON "Conversation"("branch_request_id");

-- CreateIndex
CREATE INDEX "Conversation_agentId_idx" ON "Conversation"("agentId");

-- CreateIndex
CREATE INDEX "Conversation_userId_idx" ON "Conversation"("userId");

-- CreateIndex
CREATE INDEX "Conversation_userId_agentId_createdAt_idx" ON "Conversation"("userId", "agentId", "createdAt");

-- CreateIndex
CREATE INDEX "Conversation_userId_agentId_updatedAt_idx" ON "Conversation"("userId", "agentId", "updatedAt");

-- CreateIndex
CREATE INDEX "Conversation_current_leaf_message_id_idx" ON "Conversation"("current_leaf_message_id");

-- CreateIndex
CREATE INDEX "Conversation_parent_conversation_id_idx" ON "Conversation"("parent_conversation_id");

-- CreateIndex
CREATE INDEX "Conversation_branch_from_message_id_idx" ON "Conversation"("branch_from_message_id");

-- CreateIndex
CREATE INDEX "Conversation_last_message_at_createdAt_idx" ON "Conversation"("last_message_at", "createdAt");

-- CreateIndex
CREATE INDEX "idx_conversation_purge_after" ON "Conversation"("purge_after");

-- CreateIndex
CREATE INDEX "idx_conversation_runtime_setting_user" ON "conversation_runtime_setting"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "idx_conversation_runtime_setting_workspace" ON "conversation_runtime_setting"("workspace_id");

-- CreateIndex
CREATE INDEX "idx_automation_due" ON "automation"("status", "next_wake_at");

-- CreateIndex
CREATE INDEX "idx_automation_user_status" ON "automation"("user_id", "status");

-- CreateIndex
CREATE INDEX "idx_automation_conversation_status" ON "automation"("conversation_id", "status");

-- CreateIndex
CREATE INDEX "idx_automation_anchor_message" ON "automation"("anchor_message_id");

-- CreateIndex
CREATE INDEX "idx_automation_expires" ON "automation"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "automation_run_trace_id_key" ON "automation_run"("trace_id");

-- CreateIndex
CREATE INDEX "idx_automation_run_history" ON "automation_run"("automation_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_automation_run_pending" ON "automation_run"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_automation_run_schedule" ON "automation_run"("automation_id", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "ChatTurnRequest_traceId_key" ON "ChatTurnRequest"("traceId");

-- CreateIndex
CREATE INDEX "ChatTurnRequest_conversationId_status_sequence_idx" ON "ChatTurnRequest"("conversationId", "status", "sequence");

-- CreateIndex
CREATE INDEX "ChatTurnRequest_userId_status_updatedAt_idx" ON "ChatTurnRequest"("userId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatTurnRequest_conversationId_clientMessageId_key" ON "ChatTurnRequest"("conversationId", "clientMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatTurnRequest_conversationId_sequence_key" ON "ChatTurnRequest"("conversationId", "sequence");

-- CreateIndex
CREATE INDEX "ConversationDigest_conversationId_userId_idx" ON "ConversationDigest"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "ConversationDigest_userId_agentId_idx" ON "ConversationDigest"("userId", "agentId");

-- CreateIndex
CREATE INDEX "ConversationDigest_topicKey_idx" ON "ConversationDigest"("topicKey");

-- CreateIndex
CREATE INDEX "ConversationDigest_status_idx" ON "ConversationDigest"("status");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "Message_conversationId_parent_message_id_idx" ON "Message"("conversationId", "parent_message_id");

-- CreateIndex
CREATE INDEX "Message_parent_message_id_idx" ON "Message"("parent_message_id");

-- CreateIndex
CREATE INDEX "Message_root_message_id_idx" ON "Message"("root_message_id");

-- CreateIndex
CREATE INDEX "Message_branch_id_idx" ON "Message"("branch_id");

-- CreateIndex
CREATE INDEX "Message_sender_type_sender_user_id_idx" ON "Message"("sender_type", "sender_user_id");

-- CreateIndex
CREATE INDEX "Message_sender_type_sender_agent_id_idx" ON "Message"("sender_type", "sender_agent_id");

-- CreateIndex
CREATE INDEX "Message_trace_id_idx" ON "Message"("trace_id");

-- CreateIndex
CREATE INDEX "idx_message_deleted_at" ON "Message"("deleted_at");

-- CreateIndex
CREATE INDEX "UserLlmCredential_userId_idx" ON "UserLlmCredential"("userId");

-- CreateIndex
CREATE INDEX "UserLlmCredential_status_idx" ON "UserLlmCredential"("status");

-- CreateIndex
CREATE UNIQUE INDEX "UserLlmCredential_userId_providerKey_key" ON "UserLlmCredential"("userId", "providerKey");

-- CreateIndex
CREATE INDEX "UserVoiceAsset_userId_providerKey_idx" ON "UserVoiceAsset"("userId", "providerKey");

-- CreateIndex
CREATE INDEX "idx_user_voice_asset_status" ON "UserVoiceAsset"("status");

-- CreateIndex
CREATE INDEX "UserVoiceAsset_deletedAt_idx" ON "UserVoiceAsset"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserVoiceAsset_userId_providerKey_externalVoiceId_key" ON "UserVoiceAsset"("userId", "providerKey", "externalVoiceId");

-- CreateIndex
CREATE INDEX "UserWebSearchSetting_providerKey_idx" ON "UserWebSearchSetting"("providerKey");

-- CreateIndex
CREATE INDEX "UserWebSearchSetting_status_idx" ON "UserWebSearchSetting"("status");

-- CreateIndex
CREATE UNIQUE INDEX "runtime_workspace_workspace_key_key" ON "runtime_workspace"("workspace_key");

-- CreateIndex
CREATE INDEX "idx_runtime_workspace_user" ON "runtime_workspace"("user_id");

-- CreateIndex
CREATE INDEX "idx_runtime_workspace_agent" ON "runtime_workspace"("agent_id");

-- CreateIndex
CREATE INDEX "idx_runtime_workspace_user_agent" ON "runtime_workspace"("user_id", "agent_id");

-- CreateIndex
CREATE INDEX "idx_runtime_workspace_user_conversation" ON "runtime_workspace"("user_id", "conversation_id");

-- CreateIndex
CREATE INDEX "idx_runtime_workspace_agent_conversation" ON "runtime_workspace"("agent_id", "conversation_id");

-- CreateIndex
CREATE INDEX "idx_runtime_workspace_conversation" ON "runtime_workspace"("conversation_id");

-- CreateIndex
CREATE INDEX "idx_runtime_workspace_key" ON "runtime_workspace"("workspace_key");

-- CreateIndex
CREATE INDEX "idx_runtime_workspace_deleted_at" ON "runtime_workspace"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "McpServerConfig_name_key" ON "McpServerConfig"("name");

-- CreateIndex
CREATE UNIQUE INDEX "McpServerConfig_stable_key_key" ON "McpServerConfig"("stable_key");

-- CreateIndex
CREATE INDEX "McpServerConfig_source_visibility_review_status_idx" ON "McpServerConfig"("source", "visibility", "review_status");

-- CreateIndex
CREATE INDEX "McpServerConfig_owner_user_id_status_idx" ON "McpServerConfig"("owner_user_id", "status");

-- CreateIndex
CREATE INDEX "McpServerConfig_status_idx" ON "McpServerConfig"("status");

-- CreateIndex
CREATE INDEX "McpServerConfig_scope_tenantId_idx" ON "McpServerConfig"("scope", "tenantId");

-- CreateIndex
CREATE INDEX "idx_mcp_installation_user_state" ON "McpInstallation"("userId", "enabled", "status");

-- CreateIndex
CREATE INDEX "idx_mcp_installation_server_state" ON "McpInstallation"("serverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_mcp_installation_user_server" ON "McpInstallation"("userId", "serverId");

-- CreateIndex
CREATE UNIQUE INDEX "McpCredential_installation_id_key" ON "McpCredential"("installation_id");

-- CreateIndex
CREATE INDEX "idx_mcp_credential_user_kind" ON "McpCredential"("user_id", "kind");

-- CreateIndex
CREATE INDEX "McpAuthSession_serverId_status_idx" ON "McpAuthSession"("serverId", "status");

-- CreateIndex
CREATE INDEX "McpAuthSession_userId_idx" ON "McpAuthSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "McpAuthSession_serverId_tenantId_userId_agentId_key" ON "McpAuthSession"("serverId", "tenantId", "userId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX "McpOAuthState_state_key" ON "McpOAuthState"("state");

-- CreateIndex
CREATE INDEX "McpOAuthState_serverId_idx" ON "McpOAuthState"("serverId");

-- CreateIndex
CREATE INDEX "McpOAuthState_expiresAt_idx" ON "McpOAuthState"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "McpConnectionState_identityHash_key" ON "McpConnectionState"("identityHash");

-- CreateIndex
CREATE INDEX "McpConnectionState_serverId_status_idx" ON "McpConnectionState"("serverId", "status");

-- CreateIndex
CREATE INDEX "McpConnectionState_installation_id_status_idx" ON "McpConnectionState"("installation_id", "status");

-- CreateIndex
CREATE INDEX "McpConnectionState_tenantId_userId_agentId_idx" ON "McpConnectionState"("tenantId", "userId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX "McpToolSnapshot_runtimeToolId_key" ON "McpToolSnapshot"("runtimeToolId");

-- CreateIndex
CREATE INDEX "McpToolSnapshot_serverId_status_idx" ON "McpToolSnapshot"("serverId", "status");

-- CreateIndex
CREATE INDEX "McpToolSnapshot_installation_id_status_idx" ON "McpToolSnapshot"("installation_id", "status");

-- CreateIndex
CREATE INDEX "McpToolSnapshot_snapshotHash_idx" ON "McpToolSnapshot"("snapshotHash");

-- CreateIndex
CREATE UNIQUE INDEX "uq_mcp_snapshot_installation_tool" ON "McpToolSnapshot"("installation_id", "toolName");

-- CreateIndex
CREATE INDEX "McpToolInvocation_runtimeToolId_idx" ON "McpToolInvocation"("runtimeToolId");

-- CreateIndex
CREATE INDEX "McpToolInvocation_serverId_status_idx" ON "McpToolInvocation"("serverId", "status");

-- CreateIndex
CREATE INDEX "McpToolInvocation_installation_id_status_idx" ON "McpToolInvocation"("installation_id", "status");

-- CreateIndex
CREATE INDEX "McpToolInvocation_tenantId_userId_idx" ON "McpToolInvocation"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "McpToolInvocation_conversation_id_turn_id_idx" ON "McpToolInvocation"("conversation_id", "turn_id");

-- CreateIndex
CREATE INDEX "McpToolInvocation_traceId_idx" ON "McpToolInvocation"("traceId");

-- CreateIndex
CREATE INDEX "McpAuditLog_eventType_occurredAt_idx" ON "McpAuditLog"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "McpAuditLog_serverId_idx" ON "McpAuditLog"("serverId");

-- CreateIndex
CREATE INDEX "McpAuditLog_runtimeToolId_idx" ON "McpAuditLog"("runtimeToolId");

-- CreateIndex
CREATE INDEX "McpAuditLog_tenantId_userId_idx" ON "McpAuditLog"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "McpAuditLog_traceId_idx" ON "McpAuditLog"("traceId");

-- CreateIndex
CREATE UNIQUE INDEX "ComputerUseSession_resumeTokenHash_key" ON "ComputerUseSession"("resumeTokenHash");

-- CreateIndex
CREATE INDEX "ComputerUseSession_conversationId_createdAt_idx" ON "ComputerUseSession"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ComputerUseSession_taskId_idx" ON "ComputerUseSession"("taskId");

-- CreateIndex
CREATE INDEX "ComputerUseSession_expiresAt_idx" ON "ComputerUseSession"("expiresAt");

-- CreateIndex
CREATE INDEX "ComputerUseStepRun_sessionId_order_idx" ON "ComputerUseStepRun"("sessionId", "order");

-- CreateIndex
CREATE INDEX "ComputerUseStepRun_taskId_createdAt_idx" ON "ComputerUseStepRun"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "ComputerUseCheckpoint_sessionId_createdAt_idx" ON "ComputerUseCheckpoint"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ComputerUseCheckpoint_taskId_createdAt_idx" ON "ComputerUseCheckpoint"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "ComputerUseSkillTrace_userId_host_taskPattern_idx" ON "ComputerUseSkillTrace"("userId", "host", "taskPattern");

-- CreateIndex
CREATE INDEX "ComputerUseSkillTrace_userId_host_taskPattern_slotSignature_idx" ON "ComputerUseSkillTrace"("userId", "host", "taskPattern", "slotSignature");

-- CreateIndex
CREATE INDEX "ComputerUseSkillTrace_host_taskPattern_idx" ON "ComputerUseSkillTrace"("host", "taskPattern");

-- CreateIndex
CREATE INDEX "ComputerUseSkillTrace_host_taskPattern_slotSignature_idx" ON "ComputerUseSkillTrace"("host", "taskPattern", "slotSignature");

-- CreateIndex
CREATE INDEX "ComputerUseSkillTrace_qualityScore_idx" ON "ComputerUseSkillTrace"("qualityScore");

-- CreateIndex
CREATE INDEX "ComputerUseSkillTrace_disabledAt_idx" ON "ComputerUseSkillTrace"("disabledAt");

-- CreateIndex
CREATE UNIQUE INDEX "runtime_event_outbox_event_id_key" ON "runtime_event_outbox"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "runtime_event_outbox_deduplication_key_key" ON "runtime_event_outbox"("deduplication_key");

-- CreateIndex
CREATE INDEX "idx_runtime_outbox_pending" ON "runtime_event_outbox"("status", "available_at");

-- CreateIndex
CREATE INDEX "idx_runtime_outbox_aggregate" ON "runtime_event_outbox"("aggregate_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_runtime_outbox_claim_expiry" ON "runtime_event_outbox"("claim_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "runtime_timeline_event_event_id_key" ON "runtime_timeline_event"("event_id");

-- CreateIndex
CREATE INDEX "idx_runtime_timeline_conversation_sequence" ON "runtime_timeline_event"("conversation_id", "sequence");

-- CreateIndex
CREATE INDEX "idx_runtime_timeline_presentation_sequence" ON "runtime_timeline_event"("presentation_message_id", "sequence");

-- CreateIndex
CREATE INDEX "idx_runtime_timeline_workflow_sequence" ON "runtime_timeline_event"("workflow_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "uq_runtime_timeline_presentation_identity_version" ON "runtime_timeline_event"("presentation_message_id", "identity_key", "version");

-- CreateIndex
CREATE INDEX "idx_workflow_run_scope_status" ON "workflow_run"("user_id", "agent_id", "conversation_id", "status");

-- CreateIndex
CREATE INDEX "idx_workflow_run_conversation_updated" ON "workflow_run"("conversation_id", "updated_at");

-- CreateIndex
CREATE INDEX "idx_workflow_run_workspace_status" ON "workflow_run"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "idx_workflow_run_recovery" ON "workflow_run"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "idx_workflow_phase_position" ON "workflow_phase"("workflow_id", "position");

-- CreateIndex
CREATE INDEX "idx_workflow_phase_status_position" ON "workflow_phase"("workflow_id", "status", "position");

-- CreateIndex
CREATE INDEX "idx_workflow_phase_parent_position" ON "workflow_phase"("workflow_id", "parent_phase_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_turn_link_trace_id_key" ON "workflow_turn_link"("trace_id");

-- CreateIndex
CREATE INDEX "idx_workflow_turn_link_workflow" ON "workflow_turn_link"("workflow_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_workflow_turn_link_phase" ON "workflow_turn_link"("phase_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_event_event_id_key" ON "workflow_event"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_event_deduplication_key_key" ON "workflow_event"("deduplication_key");

-- CreateIndex
CREATE INDEX "idx_workflow_event_created" ON "workflow_event"("workflow_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_workflow_event_type" ON "workflow_event"("type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_workflow_event_sequence" ON "workflow_event"("workflow_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "agent_turn_trace_id_key" ON "agent_turn"("trace_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_turn_user_message_id_key" ON "agent_turn"("user_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_turn_assistant_message_id_key" ON "agent_turn"("assistant_message_id");

-- CreateIndex
CREATE INDEX "idx_agent_turn_owner" ON "agent_turn"("user_id", "conversation_id");

-- CreateIndex
CREATE INDEX "idx_agent_turn_conversation_time" ON "agent_turn"("conversation_id", "started_at");

-- CreateIndex
CREATE INDEX "idx_agent_turn_active_scope" ON "agent_turn"("conversation_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "idx_agent_turn_workspace_status" ON "agent_turn"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "idx_agent_turn_status" ON "agent_turn"("status");

-- CreateIndex
CREATE INDEX "idx_agent_turn_checkpoint_turn" ON "agent_turn_checkpoint"("turn_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_agent_turn_checkpoint_approval" ON "agent_turn_checkpoint"("pending_approval_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_approval_approval_id_key" ON "agent_approval"("approval_id");

-- CreateIndex
CREATE INDEX "idx_agent_approval_user_status" ON "agent_approval"("user_id", "status");

-- CreateIndex
CREATE INDEX "idx_agent_approval_turn_status" ON "agent_approval"("turn_id", "status");

-- CreateIndex
CREATE INDEX "idx_agent_approval_scope_status" ON "agent_approval"("scope_type", "scope_id", "status");

-- CreateIndex
CREATE INDEX "idx_agent_approval_workflow_status" ON "agent_approval"("workflow_id", "status");

-- CreateIndex
CREATE INDEX "idx_agent_approval_step_time" ON "agent_approval"("step_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_agent_approval_descriptor" ON "agent_approval"("descriptor_hash");

-- CreateIndex
CREATE INDEX "idx_agent_approval_conversation" ON "agent_approval"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_turn_input_turn_id_consumed_at_idx" ON "agent_turn_input"("turn_id", "consumed_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_turn_input_turn_id_client_input_id_key" ON "agent_turn_input"("turn_id", "client_input_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_turn_input_turn_id_sequence_key" ON "agent_turn_input"("turn_id", "sequence");

-- CreateIndex
CREATE INDEX "agent_turn_event_turn_id_kind_idx" ON "agent_turn_event"("turn_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "agent_turn_event_turn_id_sequence_key" ON "agent_turn_event"("turn_id", "sequence");

-- AddForeignKey
ALTER TABLE "local_account" ADD CONSTRAINT "local_account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_relation" ADD CONSTRAINT "memory_relation_from_memory_id_fkey" FOREIGN KEY ("from_memory_id") REFERENCES "memory_fact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_relation" ADD CONSTRAINT "memory_relation_to_memory_id_fkey" FOREIGN KEY ("to_memory_id") REFERENCES "memory_fact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_embedding" ADD CONSTRAINT "memory_embedding_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memory_fact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAgent" ADD CONSTRAINT "UserAgent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAgent" ADD CONSTRAINT "UserAgent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_knowledge_object" ADD CONSTRAINT "agent_knowledge_object_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_knowledge_object" ADD CONSTRAINT "agent_knowledge_object_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_knowledge_chunk" ADD CONSTRAINT "agent_knowledge_chunk_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "agent_knowledge_object"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_object" ADD CONSTRAINT "runtime_object_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_object" ADD CONSTRAINT "runtime_object_origin_agent_id_fkey" FOREIGN KEY ("origin_agent_id") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_object" ADD CONSTRAINT "runtime_object_origin_conversation_id_fkey" FOREIGN KEY ("origin_conversation_id") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_object_link" ADD CONSTRAINT "message_object_link_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_object_link" ADD CONSTRAINT "message_object_link_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "runtime_object"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_project_object" ADD CONSTRAINT "code_project_object_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "code_project_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_symbol" ADD CONSTRAINT "code_symbol_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "code_project_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_symbol" ADD CONSTRAINT "code_symbol_project_object_id_fkey" FOREIGN KEY ("project_object_id") REFERENCES "code_project_object"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_patch_run" ADD CONSTRAINT "code_patch_run_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_patch_run" ADD CONSTRAINT "code_patch_run_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_patch_run" ADD CONSTRAINT "code_patch_run_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "code_project_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_patch_run" ADD CONSTRAINT "code_patch_run_package_artifact_id_fkey" FOREIGN KEY ("package_artifact_id") REFERENCES "package_artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_artifact" ADD CONSTRAINT "package_artifact_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_artifact" ADD CONSTRAINT "package_artifact_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_artifact_entry" ADD CONSTRAINT "package_artifact_entry_package_artifact_id_fkey" FOREIGN KEY ("package_artifact_id") REFERENCES "package_artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill" ADD CONSTRAINT "skill_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "skill_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill" ADD CONSTRAINT "skill_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "User"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill" ADD CONSTRAINT "skill_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_source" ADD CONSTRAINT "skill_source_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_file" ADD CONSTRAINT "skill_file_skill_version_id_fkey" FOREIGN KEY ("skill_version_id") REFERENCES "skill_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_config_schema" ADD CONSTRAINT "skill_config_schema_skill_version_id_fkey" FOREIGN KEY ("skill_version_id") REFERENCES "skill_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_dependency" ADD CONSTRAINT "skill_dependency_skill_version_id_fkey" FOREIGN KEY ("skill_version_id") REFERENCES "skill_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_dependency" ADD CONSTRAINT "skill_dependency_dependency_skill_id_fkey" FOREIGN KEY ("dependency_skill_id") REFERENCES "skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_tool_binding" ADD CONSTRAINT "skill_tool_binding_skill_version_id_fkey" FOREIGN KEY ("skill_version_id") REFERENCES "skill_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_mcp_binding" ADD CONSTRAINT "skill_mcp_binding_skill_version_id_fkey" FOREIGN KEY ("skill_version_id") REFERENCES "skill_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_mcp_binding" ADD CONSTRAINT "skill_mcp_binding_mcp_server_id_fkey" FOREIGN KEY ("mcp_server_id") REFERENCES "McpServerConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cognitive_agent_skill_policy" ADD CONSTRAINT "cognitive_agent_skill_policy_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cognitive_agent_skill_binding" ADD CONSTRAINT "cognitive_agent_skill_binding_cognitive_agent_id_fkey" FOREIGN KEY ("cognitive_agent_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cognitive_agent_skill_binding" ADD CONSTRAINT "cognitive_agent_skill_binding_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cognitive_agent_skill_binding" ADD CONSTRAINT "cognitive_agent_skill_binding_pinned_version_id_fkey" FOREIGN KEY ("pinned_version_id") REFERENCES "skill_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_installation" ADD CONSTRAINT "skill_installation_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_installation" ADD CONSTRAINT "skill_installation_installed_by_user_id_fkey" FOREIGN KEY ("installed_by_user_id") REFERENCES "User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_installation" ADD CONSTRAINT "skill_installation_pinned_version_id_fkey" FOREIGN KEY ("pinned_version_id") REFERENCES "skill_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_skill_activation" ADD CONSTRAINT "conversation_skill_activation_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_skill_activation" ADD CONSTRAINT "conversation_skill_activation_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_skill_activation" ADD CONSTRAINT "conversation_skill_activation_selected_version_id_fkey" FOREIGN KEY ("selected_version_id") REFERENCES "skill_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_skill_activation" ADD CONSTRAINT "conversation_skill_activation_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_acl_entry" ADD CONSTRAINT "skill_acl_entry_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_validation_run" ADD CONSTRAINT "skill_validation_run_skill_version_id_fkey" FOREIGN KEY ("skill_version_id") REFERENCES "skill_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_validation_run" ADD CONSTRAINT "skill_validation_run_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_usage_event" ADD CONSTRAINT "skill_usage_event_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_usage_event" ADD CONSTRAINT "skill_usage_event_skill_version_id_fkey" FOREIGN KEY ("skill_version_id") REFERENCES "skill_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_usage_event" ADD CONSTRAINT "skill_usage_event_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_usage_event" ADD CONSTRAINT "skill_usage_event_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_usage_event" ADD CONSTRAINT "skill_usage_event_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_audit_log" ADD CONSTRAINT "skill_audit_log_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_audit_log" ADD CONSTRAINT "skill_audit_log_skill_version_id_fkey" FOREIGN KEY ("skill_version_id") REFERENCES "skill_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_audit_log" ADD CONSTRAINT "skill_audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cognitive_agent_profile" ADD CONSTRAINT "cognitive_agent_profile_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_agent_profile" ADD CONSTRAINT "service_agent_profile_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_parent_conversation_id_fkey" FOREIGN KEY ("parent_conversation_id") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_branch_from_message_id_fkey" FOREIGN KEY ("branch_from_message_id") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_runtime_setting" ADD CONSTRAINT "conversation_runtime_setting_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation" ADD CONSTRAINT "automation_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatTurnRequest" ADD CONSTRAINT "ChatTurnRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLlmCredential" ADD CONSTRAINT "UserLlmCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLlmPreference" ADD CONSTRAINT "UserLlmPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserVoiceAsset" ADD CONSTRAINT "UserVoiceAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWebSearchSetting" ADD CONSTRAINT "UserWebSearchSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpServerConfig" ADD CONSTRAINT "McpServerConfig_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpInstallation" ADD CONSTRAINT "McpInstallation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpInstallation" ADD CONSTRAINT "McpInstallation_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "McpServerConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpCredential" ADD CONSTRAINT "McpCredential_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "McpInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpCredential" ADD CONSTRAINT "McpCredential_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpAuthSession" ADD CONSTRAINT "McpAuthSession_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "McpServerConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpConnectionState" ADD CONSTRAINT "McpConnectionState_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "McpServerConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpConnectionState" ADD CONSTRAINT "McpConnectionState_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "McpInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpToolSnapshot" ADD CONSTRAINT "McpToolSnapshot_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "McpServerConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpToolSnapshot" ADD CONSTRAINT "McpToolSnapshot_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "McpInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpToolInvocation" ADD CONSTRAINT "McpToolInvocation_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "McpServerConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpToolInvocation" ADD CONSTRAINT "McpToolInvocation_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "McpInstallation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpToolInvocation" ADD CONSTRAINT "McpToolInvocation_toolSnapshotId_fkey" FOREIGN KEY ("toolSnapshotId") REFERENCES "McpToolSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerUseStepRun" ADD CONSTRAINT "ComputerUseStepRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ComputerUseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputerUseCheckpoint" ADD CONSTRAINT "ComputerUseCheckpoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ComputerUseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_timeline_event" ADD CONSTRAINT "runtime_timeline_event_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "runtime_workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_phase" ADD CONSTRAINT "workflow_phase_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflow_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_phase" ADD CONSTRAINT "workflow_phase_parent_phase_id_fkey" FOREIGN KEY ("parent_phase_id") REFERENCES "workflow_phase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_turn_link" ADD CONSTRAINT "workflow_turn_link_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflow_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_turn_link" ADD CONSTRAINT "workflow_turn_link_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "workflow_phase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflow_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "workflow_phase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_turn_checkpoint" ADD CONSTRAINT "agent_turn_checkpoint_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "agent_turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_approval" ADD CONSTRAINT "agent_approval_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "agent_turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_turn_input" ADD CONSTRAINT "agent_turn_input_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "agent_turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_turn_event" ADD CONSTRAINT "agent_turn_event_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "agent_turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
