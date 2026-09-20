import type { Request } from 'express';

export interface AuthenticatedPrincipal {
  id: string;
  email?: string | null;
  role: string;
  roles: string[];
  tokenId?: string | null;
}

export type AuthenticatedRequest = Request & { user?: AuthenticatedPrincipal };
