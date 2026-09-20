import {
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { McpOAuthFlowService } from '../auth/oauth/mcp-oauth-flow.service';
import type { McpRuntimeConfig } from '../domain/mcp-runtime.types';
import { MCP_RUNTIME_CONFIG } from '../mcp-runtime.tokens';
import { McpInstallationRuntimeService } from '../runtime/mcp-installation-runtime.service';
import { McpPrincipalFactory } from './mcp-principal.factory';

@Controller('mcp-runtime/oauth')
export class McpOAuthController {
  constructor(
    private readonly oauth: McpOAuthFlowService,
    private readonly runtime: McpInstallationRuntimeService,
    private readonly principals: McpPrincipalFactory,
    @Inject(MCP_RUNTIME_CONFIG)
    private readonly config: McpRuntimeConfig,
  ) {}

  @Post('installations/:installationId/initiate')
  async initiate(
    @Param('installationId') installationId: string,
    @Req() request: Request,
  ) {
    return this.oauth.initiate(
      installationId,
      await this.principals.fromRequest(request),
      this.callbackUrl(request),
    );
  }

  @Get('installations/:installationId/status')
  async status(
    @Param('installationId') installationId: string,
    @Req() request: Request,
  ) {
    const principal = await this.principals.fromRequest(request);
    return this.oauth.status(principal.userId, installationId);
  }

  @Post('installations/:installationId/revoke')
  async revoke(
    @Param('installationId') installationId: string,
    @Req() request: Request,
  ) {
    const principal = await this.principals.fromRequest(request);
    await this.runtime.disconnectInstallation(installationId).catch(() => undefined);
    await this.oauth.revoke(principal.userId, installationId);
    return { revoked: true };
  }

  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('iss') iss: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() response: Response,
  ) {
    try {
      const result = await this.oauth.callback({
        code,
        state,
        iss,
        error,
        errorDescription,
      });
      const connectionStarted = await this.runtime
        .startConnect(result.userId, result.installationId)
        .then(() => true)
        .catch(() => false);
      response
        .status(200)
        .type('html')
        .send(this.resultPage(true, connectionStarted ? 'MCP_CONNECTING' : 'MCP_AUTHORIZED'));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'OAuth authorization failed.';
      response
        .status(400)
        .type('html')
        .send(this.resultPage(false, message));
    }
  }

  private callbackUrl(_request: Request): string {
    const configured = this.config.oauthRedirectBaseUrl.replace(/\/+$/, '');
    if (!configured) {
      throw new ServiceUnavailableException(
        'MCP_RUNTIME_OAUTH_REDIRECT_BASE_URL_REQUIRED',
      );
    }
    const callback = configured.endsWith('/callback')
      ? configured
      : `${configured}/callback`;
    const url = new URL(callback);
    const loopback = ['127.0.0.1', '::1', 'localhost'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      throw new ServiceUnavailableException(
        'MCP_RUNTIME_OAUTH_REDIRECT_URL_INVALID',
      );
    }
    return url.toString();
  }

  private resultPage(success: boolean, message: string): string {
    const safeMessage = this.escapeHtml(message);
    const accent = success ? '#0c5cfb' : '#dc2626';
    const autoClose = success
      ? '<script>setTimeout(function(){ try { window.close(); } catch {} }, 650);</script>'
      : '';
    return `<!doctype html>
<html lang="und">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SEEKMORE</title>
</head>
<body style="margin:0;background:#f7f7f7;color:#202020;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;">
    <section style="width:min(460px,100%);background:#fff;border:1px solid #e2e2e2;border-radius:20px;padding:32px;box-sizing:border-box;text-align:center;">
      <div style="width:44px;height:44px;margin:0 auto 18px;border-radius:50%;background:${accent};"></div>
      <h1 style="margin:0;font-size:20px;">SEEKMORE</h1>
      <p style="margin:14px 0 0;font-size:12px;line-height:1.7;color:#777;word-break:break-word;">${safeMessage}</p>
    </section>
  </main>
  ${autoClose}
</body>
</html>`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
}
