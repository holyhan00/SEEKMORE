import type { Tool } from './toolstypes';

type BuiltinToolMetadata = Pick<
  Tool,
  | 'displayName'
  | 'providerKind'
  | 'capabilityKinds'
  | 'sourceTypes'
  | 'riskLevel'
  | 'sideEffectClass'
  | 'idempotency'
  | 'requiresApproval'
  | 'sensitiveInputKeys'
>;

const BUILTIN_TOOL_METADATA: Readonly<Record<string, BuiltinToolMetadata>> = Object.freeze({
  skill_search: {
    displayName: 'Search Skills', providerKind: 'internal', capabilityKinds: ['skill.search'], sourceTypes: ['runtime_result'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  skill_view: {
    displayName: 'Load Skill', providerKind: 'internal', capabilityKinds: ['skill.load'], sourceTypes: ['runtime_result'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  skill_read_resource: {
    displayName: 'Read Skill Resource', providerKind: 'internal', capabilityKinds: ['skill.resource.read'], sourceTypes: ['runtime_result'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  'knowledge.search': {
    displayName: 'Search Agent Knowledge', providerKind: 'knowledge', capabilityKinds: ['knowledge.search'], sourceTypes: ['knowledge'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  time: {
    displayName: 'Time', providerKind: 'internal', capabilityKinds: ['time.manage', 'time.alarm', 'time.reminder', 'time.event', 'time.countdown', 'time.stopwatch', 'time.notification'], sourceTypes: ['runtime_result'], riskLevel: 'low', sideEffectClass: 'external_effect', idempotency: 'optional', requiresApproval: false,
  },
  automation: {
    displayName: 'Automation', providerKind: 'internal', capabilityKinds: ['automation.manage', 'automation.schedule', 'automation.monitor'], sourceTypes: ['runtime_result'], riskLevel: 'low', sideEffectClass: 'external_effect', idempotency: 'optional', requiresApproval: false,
  },
  'plugins.mcp_manage': {
    displayName: 'MCP Manage', providerKind: 'internal', capabilityKinds: ['plugins.mcp.manage', 'mcp.definition.manage', 'mcp.installation.manage'], sourceTypes: ['runtime_result'], riskLevel: 'medium', sideEffectClass: 'irreversible_write', idempotency: 'optional', requiresApproval: true,
  },
  'web.search': {
    displayName: 'Web Search', providerKind: 'web', capabilityKinds: ['web_search', 'research.search'], sourceTypes: ['web'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  'image.generate': {
    displayName: 'Generate Image', providerKind: 'object', capabilityKinds: ['image.generate', 'image.edit', 'object.image.create'], sourceTypes: ['artifact', 'object'], riskLevel: 'low', sideEffectClass: 'object_create', idempotency: 'required', requiresApproval: false,
  },
  'video.generate': {
    displayName: 'Generate Video', providerKind: 'object', capabilityKinds: ['video.generate', 'object.video.create'], sourceTypes: ['artifact', 'object'], riskLevel: 'low', sideEffectClass: 'object_create', idempotency: 'required', requiresApproval: false,
  },
  'speech.synthesize': {
    displayName: 'Generate Speech', providerKind: 'object', capabilityKinds: ['speech.synthesize', 'object.audio.create'], sourceTypes: ['artifact', 'object'], riskLevel: 'low', sideEffectClass: 'object_create', idempotency: 'required', requiresApproval: false,
  },
  'voice.clone': {
    displayName: 'Clone Voice', providerKind: 'object', capabilityKinds: ['voice.clone', 'voice.asset.create'], sourceTypes: ['object'], riskLevel: 'high', sideEffectClass: 'external_effect', idempotency: 'required', requiresApproval: true,
  },
  'music.generate': {
    displayName: 'Generate Music', providerKind: 'object', capabilityKinds: ['music.generate', 'object.audio.create'], sourceTypes: ['artifact', 'object'], riskLevel: 'low', sideEffectClass: 'object_create', idempotency: 'required', requiresApproval: false,
  },
  'vision.analyze': {
    displayName: 'Analyze Image', providerKind: 'object', capabilityKinds: ['vision.analyze', 'object.image.analyze'], sourceTypes: ['object'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  'web.read': {
    displayName: 'Web Read', providerKind: 'web', capabilityKinds: ['web_read', 'source.fetch'], sourceTypes: ['web'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  'repository.inspect': {
    displayName: 'Inspect Repository', providerKind: 'code', capabilityKinds: ['repository.inspect'], sourceTypes: ['repository'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  'repository.list_tree': {
    displayName: 'List Repository Tree', providerKind: 'code', capabilityKinds: ['repository.list_tree'], sourceTypes: ['repository'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  'repository.read_file': {
    displayName: 'Read Repository File', providerKind: 'code', capabilityKinds: ['repository.read_file'], sourceTypes: ['repository'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  'workspace.inspect': {
    displayName: 'Inspect Workspace', providerKind: 'code', capabilityKinds: ['workspace.inspect', 'local.workspace.inspect'], sourceTypes: ['local_file'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  'file.search': {
    displayName: 'Search Files', providerKind: 'code', capabilityKinds: ['file.search', 'local_file.search'], sourceTypes: ['local_file'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  'file.read': {
    displayName: 'Read File', providerKind: 'code', capabilityKinds: ['file.read', 'local_file.read'], sourceTypes: ['local_file'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  'file.write': {
    displayName: 'Write File', providerKind: 'code', capabilityKinds: ['file.write', 'local_file.write'], sourceTypes: ['local_file'], riskLevel: 'medium', sideEffectClass: 'workspace_write', idempotency: 'required', requiresApproval: true,
  },
  'file.patch': {
    displayName: 'Patch File', providerKind: 'code', capabilityKinds: ['file.patch', 'local_file.patch'], sourceTypes: ['local_file'], riskLevel: 'medium', sideEffectClass: 'workspace_write', idempotency: 'required', requiresApproval: true,
  },
  'file.delete': {
    displayName: 'Delete File', providerKind: 'code', capabilityKinds: ['file.delete', 'local_file.delete'], sourceTypes: ['local_file'], riskLevel: 'high', sideEffectClass: 'irreversible_write', idempotency: 'required', requiresApproval: true,
  },
  'terminal.run': {
    displayName: 'Run Terminal Command', providerKind: 'code', capabilityKinds: ['terminal.run', 'local_process.run'], sourceTypes: ['runtime_result'], riskLevel: 'high', sideEffectClass: 'process_execution', idempotency: 'required', requiresApproval: true, sensitiveInputKeys: ['env'],
  },
  'terminal.read': {
    displayName: 'Read Terminal Session', providerKind: 'code', capabilityKinds: ['terminal.read', 'local_process.read'], sourceTypes: ['runtime_result'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  'terminal.kill': {
    displayName: 'Stop Terminal Session', providerKind: 'code', capabilityKinds: ['terminal.kill', 'local_process.kill'], sourceTypes: ['runtime_result'], riskLevel: 'medium', sideEffectClass: 'process_execution', idempotency: 'required', requiresApproval: true,
  },
  'python.execute': {
    displayName: 'Execute Python', providerKind: 'code', capabilityKinds: ['python.execute', 'code.execute'], sourceTypes: ['runtime_result'], riskLevel: 'high', sideEffectClass: 'process_execution', idempotency: 'required', requiresApproval: true, sensitiveInputKeys: ['code'],
  },
  'git.status': {
    displayName: 'Git Status', providerKind: 'code', capabilityKinds: ['git.status', 'repository.status'], sourceTypes: ['repository'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  'git.diff': {
    displayName: 'Git Diff', providerKind: 'code', capabilityKinds: ['git.diff', 'repository.diff'], sourceTypes: ['repository'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  'document.parse': {
    displayName: 'Parse Document', providerKind: 'object', capabilityKinds: ['document.parse', 'object.content.read', 'document.structure.extract'], sourceTypes: ['object'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  'object.search': {
    displayName: 'Search Objects', providerKind: 'object', capabilityKinds: ['object.search', 'uploaded_file.search'], sourceTypes: ['object'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  'object.inspect': {
    displayName: 'Inspect Object', providerKind: 'object', capabilityKinds: ['object.inspect', 'uploaded_file.inspect'], sourceTypes: ['object'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  'code_project.inspect': {
    displayName: 'Inspect Code Project', providerKind: 'code', capabilityKinds: ['code_project.inspect', 'code_project.structure'], sourceTypes: ['object'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  'document.render.docx': {
    displayName: 'Render DOCX', providerKind: 'object', capabilityKinds: ['object_artifact_create', 'document.render.docx'], sourceTypes: ['artifact'], riskLevel: 'low', sideEffectClass: 'object_create', idempotency: 'required', requiresApproval: false,
  },
  'document.render.pdf': {
    displayName: 'Render PDF', providerKind: 'object', capabilityKinds: ['object_artifact_create', 'document.render.pdf'], sourceTypes: ['artifact'], riskLevel: 'low', sideEffectClass: 'object_create', idempotency: 'required', requiresApproval: false,
  },
  'spreadsheet.render.xlsx': {
    displayName: 'Render XLSX', providerKind: 'object', capabilityKinds: ['object_artifact_create', 'spreadsheet.render.xlsx'], sourceTypes: ['artifact'], riskLevel: 'low', sideEffectClass: 'object_create', idempotency: 'required', requiresApproval: false,
  },
  'presentation.create': {
    displayName: 'Create Presentation', providerKind: 'object', capabilityKinds: ['presentation.author', 'presentation.create'], sourceTypes: ['runtime_result'], riskLevel: 'low', sideEffectClass: 'none', idempotency: 'optional', requiresApproval: false,
  },
  'presentation.slides.upsert': {
    displayName: 'Author Presentation Slides', providerKind: 'object', capabilityKinds: ['presentation.author', 'presentation.slide.write'], sourceTypes: ['runtime_result', 'object'], riskLevel: 'low', sideEffectClass: 'none', idempotency: 'optional', requiresApproval: false,
  },
  'presentation.inspect': {
    displayName: 'Inspect Presentation', providerKind: 'object', capabilityKinds: ['presentation.inspect', 'presentation.preview.verify'], sourceTypes: ['runtime_result'], riskLevel: 'low', sideEffectClass: 'read_only', idempotency: 'optional', requiresApproval: false,
  },
  'presentation.finalize': {
    displayName: 'Finalize PPTX', providerKind: 'object', capabilityKinds: ['object_artifact_create', 'presentation.finalize'], sourceTypes: ['artifact'], riskLevel: 'low', sideEffectClass: 'object_create', idempotency: 'required', requiresApproval: false,
  },
  'package.render.zip': {
    displayName: 'Render ZIP Package', providerKind: 'object', capabilityKinds: ['object_artifact_create', 'package.render.zip'], sourceTypes: ['artifact'], riskLevel: 'low', sideEffectClass: 'object_create', idempotency: 'required', requiresApproval: false,
  },
});

export function applyBuiltinToolMetadata<T extends Tool>(tool: T): T {
  const metadata = BUILTIN_TOOL_METADATA[tool.name];
  if (!metadata) throw new Error(`Missing canonical builtin tool metadata: ${tool.name}`);
  Object.assign(tool, metadata);
  return tool;
}

export function builtinToolMetadata(name: string): BuiltinToolMetadata | undefined {
  return BUILTIN_TOOL_METADATA[name];
}
