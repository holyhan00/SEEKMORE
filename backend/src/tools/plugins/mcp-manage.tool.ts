// backend/src/tools/plugins/mcp-manage.tool.ts

import { HttpException, Injectable } from '@nestjs/common';
import {
  McpLibraryService,
  type CreateMcpDefinitionInput,
} from '../../modules/mcp/application/mcp-library.service';
import type {
  Dict,
  Tool,
  ToolContext,
} from '../toolstypes';
import { ToolError } from '../toolstypes';

const ACTIONS = [
  'create',
  'install',
  'enable',
  'disable',
  'remove',
] as const;

const TRANSPORTS = [
  'stdio',
  'streamable_http',
] as const;

const AUTH_KINDS = [
  'none',
  'oauth2',
  'bearer',
  'api_key',
  'custom_headers',
  'environment',
] as const;

type McpManageAction = typeof ACTIONS[number];
type McpManageTransport = typeof TRANSPORTS[number];
type McpManageAuthKind = typeof AUTH_KINDS[number];

type McpManageNextAction =
  | 'none'
  | 'install'
  | 'enable'
  | 'configure_credentials'
  | 'authorize_oauth'
  | 'approve_local_execution'
  | 'connect';

interface McpManageInput {
  action?: McpManageAction;
  definitionId?: string;
  installationId?: string;
  displayName?: string;
  description?: string;
  transport?: McpManageTransport;
  endpoint?: string;
  command?: string;
  args?: string[];
  workingDirectory?: string;
  authKind?: McpManageAuthKind;
  headerNames?: string[];
  environmentNames?: string[];
  timeoutMs?: number;
  deleteDefinition?: boolean;
}

interface McpDefinitionLike {
  id: string;
  stableKey?: string | null;
  source?: string | null;
  ownerUserId?: string | null;
  displayName?: string | null;
  name?: string | null;
  transport?: string | null;
  authKind?: string | null;
}

interface McpInstallationLike {
  id: string;
  installationId?: string;
  serverId: string;
  stableKey?: string | null;
  source?: string | null;
  owned?: boolean;
  displayName?: string | null;
  name?: string | null;
  transport?: string | null;
  authKind?: string | null;
  enabled?: boolean;
  status?: string | null;
  configurationState?: string | null;
  connectionStatus?: string | null;
  connectionFailureCode?: string | null;
  connectionFailureMessage?: string | null;
  requiredConfigurationKeys?: string[];
  actionState?: string | null;
}

const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SENSITIVE_ARGUMENT_PATTERN = /(?:^|[-_])(api[-_]?key|token|bearer(?:[-_]?token)?|access[-_]?token|secret|password|credential)(?:$|[=:])/i;
const SENSITIVE_QUERY_KEY_PATTERN = /^(?:api[-_]?key|key|token|bearer(?:[-_]?token)?|access[-_]?token|secret|password|credential|authorization)$/i;

@Injectable()
export class McpManageTool implements Tool {
  name = 'plugins.mcp_manage';
  version = '1.0.0';
  description = [
    'Manage MCP integrations through the existing SEEKMORE MCP domain.',
    'Supported actions are create, install, enable, disable, and remove.',
    'When creating a new integration, prefer a verified official local stdio MCP when one actually exists; otherwise use a verified streamable_http MCP endpoint.',
    'Do not invent or substitute an unverified third-party local wrapper only to avoid streamable_http.',
    'Create only declares the MCP Definition; install manages the Installation and the existing MCP runtime owns connection behavior.',
    'Never generate, read, pass, or write real API keys, bearer tokens, passwords, secrets, credentials, header values, or environment values.',
    'For authentication, declare only authKind plus headerNames or environmentNames as applicable; the user-facing credential and OAuth flows remain responsible for real secrets.',
  ].join(' ');
  tags = ['plugins', 'mcp', 'manage'];
  timeoutMs = 120_000;
  maxOutputBytes = 512 * 1024;
  requiredSurfaces: NonNullable<Tool['requiredSurfaces']> = ['conversation'];
  parallelism: NonNullable<Tool['parallelism']> = 'resource_serial';
  conflictKeyFields = ['installationId', 'definitionId', 'displayName'];
  supportsAbort = false;
  latencyClass: NonNullable<Tool['latencyClass']> = 'short';

  inputSchema = {
    type: 'object',
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ACTIONS,
      },
      definitionId: {
        type: 'string',
        minLength: 1,
        maxLength: 160,
      },
      installationId: {
        type: 'string',
        minLength: 1,
        maxLength: 160,
      },
      displayName: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
      },
      description: {
        type: 'string',
        maxLength: 2_000,
      },
      transport: {
        type: 'string',
        enum: TRANSPORTS,
      },
      endpoint: {
        type: 'string',
        minLength: 1,
        maxLength: 4_096,
      },
      command: {
        type: 'string',
        minLength: 1,
        maxLength: 1_024,
      },
      args: {
        type: 'array',
        maxItems: 128,
        items: {
          type: 'string',
          maxLength: 8_192,
        },
      },
      workingDirectory: {
        type: 'string',
        maxLength: 4_096,
      },
      authKind: {
        type: 'string',
        enum: AUTH_KINDS,
      },
      headerNames: {
        type: 'array',
        maxItems: 64,
        uniqueItems: true,
        items: {
          type: 'string',
          minLength: 1,
          maxLength: 128,
        },
      },
      environmentNames: {
        type: 'array',
        maxItems: 64,
        uniqueItems: true,
        items: {
          type: 'string',
          minLength: 1,
          maxLength: 128,
        },
      },
      timeoutMs: {
        type: 'integer',
        minimum: 1_000,
        maximum: 300_000,
      },
      deleteDefinition: {
        type: 'boolean',
      },
    },
    additionalProperties: false,
  };

  outputSchema = {
    type: 'object',
    additionalProperties: true,
  };

  constructor(
    private readonly mcp: McpLibraryService,
  ) {}

  canExecute(ctx: ToolContext): boolean {
    return Boolean(ctx.userId && ctx.conversationId);
  }

  assessRisk(args: Dict) {
    const action = text(args.action);
    const deleteDefinition = args.deleteDefinition === true;
    const destructiveDefinitionDelete =
      action === 'remove' && deleteDefinition;

    return {
      riskLevel: destructiveDefinitionDelete
        ? 'high' as const
        : 'medium' as const,
      requiresApproval: true,
      reasonCodes: [
        `plugins:mcp_manage:${action || 'unknown'}`,
        destructiveDefinitionDelete
          ? 'plugins:mcp_definition_delete'
          : 'plugins:mcp_configuration_change',
      ],
      descriptor: {
        action: action || null,
        definitionId: optionalText(args.definitionId),
        installationId: optionalText(args.installationId),
        displayName: optionalText(args.displayName),
        transport: optionalText(args.transport),
        deleteDefinition,
      },
    };
  }

  async execute(
    args: Dict,
    ctx: ToolContext,
  ): Promise<unknown> {
    const input = args as McpManageInput;
    const action = text(input.action) as McpManageAction;

    if (!ACTIONS.includes(action)) {
      throw new ToolError(
        'MCP_ACTION_INVALID',
        'action must be one of create, install, enable, disable, or remove',
      );
    }

    switch (action) {
      case 'create':
        return this.create(ctx.userId, input);
      case 'install':
        return this.install(ctx.userId, input);
      case 'enable':
        return this.setEnabled(ctx.userId, input, true);
      case 'disable':
        return this.setEnabled(ctx.userId, input, false);
      case 'remove':
        return this.remove(ctx.userId, input);
    }
  }

  private async create(
    userId: string,
    input: McpManageInput,
  ): Promise<unknown> {
    const displayName = requiredText(
      input.displayName,
      'MCP_DISPLAY_NAME_REQUIRED',
      'displayName is required for create',
    );
    const transport = text(input.transport) as McpManageTransport;
    if (!TRANSPORTS.includes(transport)) {
      throw new ToolError(
        'MCP_TRANSPORT_REQUIRED',
        'transport must be stdio or streamable_http for create',
      );
    }

    const args = stringArray(input.args);
    this.assertNoSecretBearingArguments(args);

    const headerNames = this.headerNames(input.headerNames);
    const environmentNames = this.environmentNames(
      input.environmentNames,
    );
    let authKind = text(input.authKind || 'none') as McpManageAuthKind;
    if (!AUTH_KINDS.includes(authKind)) {
      throw new ToolError(
        'MCP_AUTH_KIND_INVALID',
        'Unsupported MCP authKind',
      );
    }

    let definitionInput: CreateMcpDefinitionInput;

    if (transport === 'stdio') {
      const command = requiredText(
        input.command,
        'MCP_STDIO_COMMAND_REQUIRED',
        'command is required for stdio MCP create',
      );
      if (optionalText(input.endpoint)) {
        throw new ToolError(
          'MCP_STDIO_ENDPOINT_NOT_ALLOWED',
          'endpoint is not valid for stdio MCP create',
        );
      }
      if (headerNames.length > 0) {
        throw new ToolError(
          'MCP_STDIO_HEADERS_NOT_ALLOWED',
          'headerNames are not valid for stdio MCP create',
        );
      }
      if (environmentNames.length > 0 && authKind === 'none') {
        authKind = 'environment';
      }
      if (!['none', 'environment'].includes(authKind)) {
        throw new ToolError(
          'MCP_STDIO_AUTH_KIND_UNSUPPORTED',
          'stdio MCP create supports only none or environment authKind',
        );
      }
      if (
        authKind === 'environment'
        && environmentNames.length === 0
      ) {
        throw new ToolError(
          'MCP_ENVIRONMENT_DECLARATION_REQUIRED',
          'environmentNames are required when authKind is environment',
        );
      }

      definitionInput = {
        displayName,
        description: optionalText(input.description),
        transport,
        command,
        args,
        workingDirectory: optionalText(
          input.workingDirectory,
        ),
        authKind,
        headers: {},
        environment: declaredRecord(environmentNames),
        timeoutMs: normalizedTimeout(input.timeoutMs),
      };
    } else {
      const endpoint = requiredText(
        input.endpoint,
        'MCP_HTTP_ENDPOINT_REQUIRED',
        'endpoint is required for streamable_http MCP create',
      );
      this.assertNoSecretBearingEndpoint(endpoint);

      if (
        optionalText(input.command)
        || args.length > 0
        || optionalText(input.workingDirectory)
      ) {
        throw new ToolError(
          'MCP_HTTP_LOCAL_FIELDS_NOT_ALLOWED',
          'command, args, and workingDirectory are not valid for streamable_http MCP create',
        );
      }
      if (environmentNames.length > 0 || authKind === 'environment') {
        throw new ToolError(
          'MCP_REMOTE_ENVIRONMENT_NOT_ALLOWED',
          'environment authentication is not valid for streamable_http MCP create',
        );
      }

      if (authKind === 'api_key' && headerNames.length === 0) {
        headerNames.push('X-API-Key');
      }
      if (
        authKind === 'custom_headers'
        && headerNames.length === 0
      ) {
        throw new ToolError(
          'MCP_HEADER_DECLARATION_REQUIRED',
          'headerNames are required when authKind is custom_headers',
        );
      }
      if (
        !['api_key', 'custom_headers'].includes(authKind)
        && headerNames.length > 0
      ) {
        throw new ToolError(
          'MCP_HEADER_DECLARATION_NOT_ALLOWED',
          'headerNames are only valid for api_key or custom_headers authKind',
        );
      }

      definitionInput = {
        displayName,
        description: optionalText(input.description),
        transport,
        endpoint,
        authKind,
        headers: declaredRecord(headerNames),
        environment: {},
        timeoutMs: normalizedTimeout(input.timeoutMs),
      };
    }

    const definition = await this.domain(
      () => this.mcp.createDefinition(
        userId,
        definitionInput,
        'AGENT_TOOL',
      ),
      'MCP_CREATE_FAILED',
    ) as McpDefinitionLike;

    return {
      action: 'create',
      changed: true,
      definition: this.definitionSummary(definition),
      nextAction: 'install' as McpManageNextAction,
    };
  }

  private async install(
    userId: string,
    input: McpManageInput,
  ): Promise<unknown> {
    const definition = await this.resolveDefinition(
      userId,
      input,
    );
    const before = await this.findInstalledByServerId(
      userId,
      definition.id,
    );
    const installed = await this.domain(
      () => this.mcp.install(userId, definition.id),
      'MCP_INSTALL_FAILED',
    ) as McpInstallationLike;

    return {
      action: 'install',
      changed: !before || before.enabled !== true,
      definition: this.definitionSummary(definition),
      installation: this.installationSummary(installed),
      nextAction: this.nextAction(installed),
    };
  }

  private async setEnabled(
    userId: string,
    input: McpManageInput,
    enabled: boolean,
  ): Promise<unknown> {
    const installation = await this.resolveInstallation(
      userId,
      input,
    );
    const changed = installation.enabled !== enabled;

    if (changed) {
      await this.domain(
        () => this.mcp.setEnabled(
          userId,
          installation.id,
          enabled,
        ),
        enabled
          ? 'MCP_ENABLE_FAILED'
          : 'MCP_DISABLE_FAILED',
      );
    }

    const refreshed = await this.findInstallationById(
      userId,
      installation.id,
    ) ?? {
      ...installation,
      enabled,
      connectionStatus: enabled
        ? installation.connectionStatus
        : 'disconnected',
    };

    return {
      action: enabled ? 'enable' : 'disable',
      changed,
      installation: this.installationSummary(refreshed),
      nextAction: enabled
        ? this.nextAction(refreshed)
        : 'none' as McpManageNextAction,
    };
  }

  private async remove(
    userId: string,
    input: McpManageInput,
  ): Promise<unknown> {
    if (input.deleteDefinition === true) {
      const definition = await this.resolveDefinitionForRemoval(
        userId,
        input,
      );
      if (
        definition.source !== 'USER'
        || definition.ownerUserId !== userId
      ) {
        throw new ToolError(
          'MCP_SYSTEM_DEFINITION_IMMUTABLE',
          'Only a USER MCP Definition owned by the current user can be deleted',
        );
      }

      await this.domain(
        () => this.mcp.deleteDefinition(
          userId,
          definition.id,
        ),
        'MCP_DEFINITION_DELETE_FAILED',
      );

      return {
        action: 'remove',
        changed: true,
        removed: true,
        deletedDefinition: true,
        definition: this.definitionSummary(definition),
        nextAction: 'none' as McpManageNextAction,
      };
    }

    const installation = await this.resolveInstallation(
      userId,
      input,
    );
    await this.domain(
      () => this.mcp.uninstall(
        userId,
        installation.id,
      ),
      'MCP_REMOVE_FAILED',
    );

    return {
      action: 'remove',
      changed: true,
      removed: true,
      deletedDefinition: false,
      installation: this.installationSummary({
        ...installation,
        enabled: false,
        status: 'uninstalled',
        connectionStatus: 'disconnected',
      }),
      nextAction: 'none' as McpManageNextAction,
    };
  }

  private async resolveDefinitionForRemoval(
    userId: string,
    input: McpManageInput,
  ): Promise<McpDefinitionLike> {
    const installationId = optionalText(
      input.installationId,
    );
    if (installationId) {
      const installation = await this.resolveInstallation(
        userId,
        input,
      );
      const definition = await this.domain(
        () => this.mcp.getDefinition(
          userId,
          installation.serverId,
        ),
        'MCP_DEFINITION_NOT_FOUND',
      ) as McpDefinitionLike;

      const suppliedDefinitionId = optionalText(
        input.definitionId,
      );
      if (
        suppliedDefinitionId
        && suppliedDefinitionId !== definition.id
      ) {
        throw new ToolError(
          'MCP_TARGET_MISMATCH',
          'installationId and definitionId refer to different MCP targets',
        );
      }
      return definition;
    }

    return this.resolveDefinition(userId, input);
  }

  private async resolveDefinition(
    userId: string,
    input: Pick<
      McpManageInput,
      'definitionId' | 'displayName'
    >,
  ): Promise<McpDefinitionLike> {
    const definitionId = optionalText(
      input.definitionId,
    );
    const displayName = optionalText(
      input.displayName,
    );

    if (definitionId) {
      const definition = await this.domain(
        () => this.mcp.getDefinition(
          userId,
          definitionId,
        ),
        'MCP_DEFINITION_NOT_FOUND',
      ) as McpDefinitionLike;
      if (
        displayName
        && !this.matchesName(definition, displayName)
      ) {
        throw new ToolError(
          'MCP_TARGET_MISMATCH',
          'definitionId and displayName refer to different MCP targets',
        );
      }
      return definition;
    }

    if (!displayName) {
      throw new ToolError(
        'MCP_DEFINITION_TARGET_REQUIRED',
        'definitionId or displayName is required',
      );
    }

    const definitions = await this.domain(
      () => this.mcp.listDefinitions(userId),
      'MCP_DEFINITION_LOOKUP_FAILED',
    ) as McpDefinitionLike[];
    const matches = definitions.filter((item) =>
      this.matchesName(item, displayName),
    );

    return this.uniqueDefinition(
      matches,
      displayName,
    );
  }

  private async resolveInstallation(
    userId: string,
    input: Pick<
      McpManageInput,
      'installationId' | 'definitionId' | 'displayName'
    >,
  ): Promise<McpInstallationLike> {
    const installations = await this.domain(
      () => this.mcp.listInstallations(userId),
      'MCP_INSTALLATION_LOOKUP_FAILED',
    ) as McpInstallationLike[];
    const installationId = optionalText(
      input.installationId,
    );
    const definitionId = optionalText(
      input.definitionId,
    );
    const displayName = optionalText(
      input.displayName,
    );

    if (installationId) {
      const installation = installations.find(
        (item) => item.id === installationId,
      );
      if (!installation) {
        throw new ToolError(
          'MCP_INSTALLATION_NOT_FOUND',
          `MCP installation not found: ${installationId}`,
        );
      }
      if (
        definitionId
        && installation.serverId !== definitionId
      ) {
        throw new ToolError(
          'MCP_TARGET_MISMATCH',
          'installationId and definitionId refer to different MCP targets',
        );
      }
      if (
        displayName
        && !this.matchesName(installation, displayName)
      ) {
        throw new ToolError(
          'MCP_TARGET_MISMATCH',
          'installationId and displayName refer to different MCP targets',
        );
      }
      return installation;
    }

    let matches = installations;
    if (definitionId) {
      matches = matches.filter(
        (item) => item.serverId === definitionId,
      );
    }
    if (displayName) {
      matches = matches.filter((item) =>
        this.matchesName(item, displayName),
      );
    }
    if (!definitionId && !displayName) {
      throw new ToolError(
        'MCP_INSTALLATION_TARGET_REQUIRED',
        'installationId, definitionId, or displayName is required',
      );
    }

    return this.uniqueInstallation(
      matches,
      displayName || definitionId || '',
    );
  }

  private async findInstalledByServerId(
    userId: string,
    serverId: string,
  ): Promise<McpInstallationLike | null> {
    const installations = await this.domain(
      () => this.mcp.listInstallations(userId),
      'MCP_INSTALLATION_LOOKUP_FAILED',
    ) as McpInstallationLike[];
    return installations.find(
      (item) => item.serverId === serverId,
    ) ?? null;
  }

  private async findInstallationById(
    userId: string,
    installationId: string,
  ): Promise<McpInstallationLike | null> {
    const installations = await this.domain(
      () => this.mcp.listInstallations(userId),
      'MCP_INSTALLATION_LOOKUP_FAILED',
    ) as McpInstallationLike[];
    return installations.find(
      (item) => item.id === installationId,
    ) ?? null;
  }

  private uniqueDefinition(
    matches: McpDefinitionLike[],
    target: string,
  ): McpDefinitionLike {
    if (matches.length === 0) {
      throw new ToolError(
        'MCP_DEFINITION_NOT_FOUND',
        `MCP Definition not found: ${target}`,
      );
    }
    if (matches.length > 1) {
      throw new ToolError(
        'MCP_TARGET_AMBIGUOUS',
        `Multiple MCP Definitions match: ${target}`,
        {
          candidates: matches.map((item) =>
            this.definitionSummary(item),
          ),
        },
      );
    }
    return matches[0];
  }

  private uniqueInstallation(
    matches: McpInstallationLike[],
    target: string,
  ): McpInstallationLike {
    if (matches.length === 0) {
      throw new ToolError(
        'MCP_INSTALLATION_NOT_FOUND',
        `MCP installation not found: ${target}`,
      );
    }
    if (matches.length > 1) {
      throw new ToolError(
        'MCP_TARGET_AMBIGUOUS',
        `Multiple MCP installations match: ${target}`,
        {
          candidates: matches.map((item) =>
            this.installationSummary(item),
          ),
        },
      );
    }
    return matches[0];
  }

  private matchesName(
    item: {
      displayName?: string | null;
      name?: string | null;
      stableKey?: string | null;
    },
    target: string,
  ): boolean {
    const wanted = normalizeName(target);
    return [
      item.displayName,
      item.name,
      item.stableKey,
    ].some((value) =>
      Boolean(value && normalizeName(value) === wanted),
    );
  }

  private definitionSummary(
    definition: McpDefinitionLike,
  ) {
    return {
      id: definition.id,
      stableKey: definition.stableKey ?? null,
      source: definition.source ?? null,
      displayName:
        definition.displayName
        ?? definition.name
        ?? definition.id,
      transport: definition.transport ?? null,
      authKind: definition.authKind ?? 'none',
    };
  }

  private installationSummary(
    installation: McpInstallationLike,
  ) {
    return {
      id: installation.id,
      installationId:
        installation.installationId
        ?? installation.id,
      serverId: installation.serverId,
      stableKey: installation.stableKey ?? null,
      source: installation.source ?? null,
      displayName:
        installation.displayName
        ?? installation.name
        ?? installation.id,
      transport: installation.transport ?? null,
      authKind: installation.authKind ?? 'none',
      enabled: installation.enabled === true,
      status: installation.status ?? null,
      configurationState:
        installation.configurationState ?? null,
      connectionStatus:
        installation.connectionStatus ?? null,
      connectionFailureCode:
        installation.connectionFailureCode ?? null,
      connectionFailureMessage:
        installation.connectionFailureMessage ?? null,
      requiredConfigurationKeys:
        installation.requiredConfigurationKeys ?? [],
      actionState: installation.actionState ?? null,
    };
  }

  private nextAction(
    installation: McpInstallationLike,
  ): McpManageNextAction {
    if (
      installation.configurationState
      === 'needs_configuration'
    ) {
      return 'configure_credentials';
    }
    if (
      installation.configurationState
      === 'needs_authorization'
    ) {
      return 'authorize_oauth';
    }
    if (installation.enabled !== true) {
      return 'enable';
    }

    const failureCode = text(
      installation.connectionFailureCode,
    ).toUpperCase();
    if (
      installation.transport === 'stdio'
      && (
        failureCode.includes('APPROV')
        || failureCode.includes('NOT_ALLOWED')
        || failureCode.includes('PERMISSION')
      )
    ) {
      return 'approve_local_execution';
    }

    if (
      installation.connectionStatus === 'connected'
      || installation.connectionStatus === 'connecting'
    ) {
      return 'none';
    }
    if (installation.configurationState === 'ready') {
      return 'connect';
    }
    return 'none';
  }

  private headerNames(
    value: unknown,
  ): string[] {
    const names = uniqueStrings(value);
    for (const name of names) {
      if (!HEADER_NAME_PATTERN.test(name)) {
        throw new ToolError(
          'MCP_HEADER_DECLARATION_INVALID',
          `Invalid MCP header name: ${name}`,
        );
      }
    }
    return names;
  }

  private environmentNames(
    value: unknown,
  ): string[] {
    const names = uniqueStrings(value);
    for (const name of names) {
      if (!ENVIRONMENT_NAME_PATTERN.test(name)) {
        throw new ToolError(
          'MCP_ENVIRONMENT_DECLARATION_INVALID',
          `Invalid MCP environment variable name: ${name}`,
        );
      }
    }
    return names;
  }

  private assertNoSecretBearingArguments(
    args: string[],
  ): void {
    for (let index = 0; index < args.length; index += 1) {
      const value = args[index].trim();
      if (!value) continue;
      if (/^Bearer\s+\S+/i.test(value)) {
        throw new ToolError(
          'MCP_SECRET_VALUE_FORBIDDEN',
          'Bearer credential values are not allowed in MCP args',
        );
      }
      if (SENSITIVE_ARGUMENT_PATTERN.test(value)) {
        throw new ToolError(
          'MCP_SECRET_VALUE_FORBIDDEN',
          'Credential-bearing MCP arguments are not allowed; declare environmentNames or headerNames instead',
          { argumentIndex: index },
        );
      }
    }
  }

  private assertNoSecretBearingEndpoint(
    endpoint: string,
  ): void {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new ToolError(
        'MCP_HTTP_ENDPOINT_INVALID',
        'streamable_http endpoint must be a valid absolute URL',
      );
    }

    if (url.username || url.password) {
      throw new ToolError(
        'MCP_SECRET_VALUE_FORBIDDEN',
        'Credentials are not allowed in an MCP endpoint URL',
      );
    }
    for (const [key, value] of url.searchParams.entries()) {
      if (
        value
        && SENSITIVE_QUERY_KEY_PATTERN.test(key)
      ) {
        throw new ToolError(
          'MCP_SECRET_VALUE_FORBIDDEN',
          'Credential values are not allowed in MCP endpoint query parameters',
          { queryKey: key },
        );
      }
    }
  }

  private async domain<T>(
    operation: () => Promise<T>,
    fallbackCode: string,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw this.domainError(error, fallbackCode);
    }
  }

  private domainError(
    error: unknown,
    fallbackCode: string,
  ): ToolError {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      const candidate =
        typeof response === 'string'
          ? response
          : response
            && typeof response === 'object'
            ? firstText(
                (response as Record<string, unknown>).code,
                (response as Record<string, unknown>).message,
              )
            : '';
      const code = errorCode(candidate)
        ? candidate
        : fallbackCode;
      return new ToolError(
        code,
        candidate || error.message || fallbackCode,
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : String(error ?? '');
    const code = errorCode(message)
      ? message
      : fallbackCode;
    return new ToolError(
      code,
      message || fallbackCode,
    );
  }
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function optionalText(
  value: unknown,
): string | undefined {
  const normalized = text(value);
  return normalized || undefined;
}

function requiredText(
  value: unknown,
  code: string,
  message: string,
): string {
  const normalized = text(value);
  if (!normalized) {
    throw new ToolError(code, message);
  }
  return normalized;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item))
    : [];
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => String(item).trim())
        .filter(Boolean),
    ),
  ];
}

function declaredRecord(
  names: string[],
): Record<string, string> {
  return Object.fromEntries(
    names.map((name) => [name, '']),
  );
}

function normalizedTimeout(
  value: unknown,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new ToolError(
      'MCP_TIMEOUT_INVALID',
      'timeoutMs must be a finite number',
    );
  }
  return Math.min(
    300_000,
    Math.max(1_000, Math.floor(numeric)),
  );
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function firstText(
  ...values: unknown[]
): string {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = firstText(...value);
      if (nested) return nested;
      continue;
    }
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return '';
}

function errorCode(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,120}$/.test(value);
}
