import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { RuntimeTraceModule } from '../../common/trace/runtime-trace.module';
import {
  MCP_AUDIT_SINK,
  MCP_AUTH_SESSION_REPOSITORY,
  MCP_OAUTH_STATE_REPOSITORY,
  MCP_RUNTIME_CONFIG,
} from './mcp-runtime.tokens';
import { loadMcpRuntimeConfig } from './config/mcp-runtime.config';
import { PrismaMcpAuthSessionRepository } from './auth/prisma-mcp-auth-session.repository';
import { PrismaMcpOAuthStateRepository } from './auth/oauth/prisma-mcp-oauth-state.repository';
import { PrismaMcpAuditSink } from './observability/prisma-mcp-audit.sink';
import { McpPrincipalFactory } from './api/mcp-principal.factory';
import { McpOAuthFlowService } from './auth/oauth/mcp-oauth-flow.service';
import { McpOAuthDiscoveryService } from './auth/oauth/mcp-oauth-discovery.service';
import { McpSecretRedactorService } from './security/mcp-secret-redactor.service';
import { McpStdioPolicyService } from './security/mcp-stdio-policy.service';
import { McpToolResultNormalizerService } from './runtime/mcp-tool-result-normalizer.service';
import { McpRuntimeToolProvider } from './runtime/mcp-runtime-tool.provider';
import { McpOAuthController } from './api/mcp-oauth.controller';
import { McpDefinitionController } from './api/mcp-definition.controller';
import { McpInstallationController } from './api/mcp-installation.controller';
import { McpChatController } from './api/mcp-chat.controller';
import { McpLibraryService } from './application/mcp-library.service';
import { McpSecretCipherService } from './application/mcp-secret-cipher.service';
import { McpConfigImportService } from './import/mcp-config-import.service';
import { McpRemoteUrlGuardService } from './runtime/mcp-remote-url-guard.service';
import { McpRemoteClientService } from './runtime/mcp-remote-client.service';
import { McpBackendStdioHostService } from './runtime/mcp-backend-stdio-host.service';
import { McpDesktopBridgeService } from './runtime/mcp-desktop-bridge.service';
import { McpInstallationRuntimeService } from './runtime/mcp-installation-runtime.service';
import { BuiltinMcpCatalogService } from './catalog/builtin-mcp-catalog.service';
import { McpSystemCatalogBootstrapService } from './bootstrap/mcp-system-catalog-bootstrap.service';

@Module({
  imports: [RuntimeTraceModule, PrismaModule],
  controllers: [
    McpDefinitionController,
    McpInstallationController,
    McpChatController,
    McpOAuthController,
  ],
  providers: [
    { provide: MCP_RUNTIME_CONFIG, useFactory: loadMcpRuntimeConfig },
    {
      provide: MCP_AUTH_SESSION_REPOSITORY,
      useClass: PrismaMcpAuthSessionRepository,
    },
    {
      provide: MCP_OAUTH_STATE_REPOSITORY,
      useClass: PrismaMcpOAuthStateRepository,
    },
    { provide: MCP_AUDIT_SINK, useClass: PrismaMcpAuditSink },
    McpPrincipalFactory,
    McpOAuthDiscoveryService,
    McpOAuthFlowService,
    McpSecretRedactorService,
    McpStdioPolicyService,
    McpToolResultNormalizerService,
    McpLibraryService,
    McpSecretCipherService,
    McpConfigImportService,
    McpRemoteUrlGuardService,
    McpRemoteClientService,
    McpBackendStdioHostService,
    McpDesktopBridgeService,
    McpInstallationRuntimeService,
    McpRuntimeToolProvider,
    BuiltinMcpCatalogService,
    McpSystemCatalogBootstrapService,
  ],
  exports: [
    McpRuntimeToolProvider,
    McpLibraryService,
    McpInstallationRuntimeService,
    BuiltinMcpCatalogService,
  ],
})
export class McpRuntimeModule {}
