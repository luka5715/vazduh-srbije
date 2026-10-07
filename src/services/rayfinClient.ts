import { RayfinClient, resolveRayfinConfig } from '@microsoft/rayfin-client';

import type { VazduhSchema } from '../../rayfin/data/schema';
import type { AppFunctionsSchema } from '../../rayfin/functions/src/types';

/** Tipizirani Rayfin klijent aplikacije: entiteti + funkcije. */
export type VazduhClient = RayfinClient<VazduhSchema, AppFunctionsSchema>;

export class MissingRayfinConfigError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(`Nedostaje Rayfin konfiguracija: ${missing.join(', ')}`);
    this.name = 'MissingRayfinConfigError';
  }
}

export interface RayfinClientDefaults {
  apiUrl?: string;
  publishableKey?: string;
  workspaceId?: string;
  itemId?: string;
  portalUrl?: string;
}

let client: VazduhClient | null = null;

/**
 * Kreira jedinstveni klijent. Vrednosti specifične za deployment čitaju se iz
 * `rayfin.config.json` koji `rayfin up` upakuje uz statički sajt (ista build
 * verzija radi u više radnih prostora); `VITE_*` promenljive su podrazumevane
 * vrednosti za lokalni razvoj.
 */
export async function initRayfinClient(defaults: RayfinClientDefaults): Promise<VazduhClient> {
  if (client) return client;
  const resolved = await resolveRayfinConfig({
    apiUrl: defaults.apiUrl,
    publishableKey: defaults.publishableKey,
    workspaceId: defaults.workspaceId,
    itemId: defaults.itemId,
    portalUrl: defaults.portalUrl,
  });
  if (!resolved.baseUrl || !resolved.publishableKey) {
    throw new MissingRayfinConfigError([
      ...(!resolved.baseUrl ? ['apiUrl'] : []),
      ...(!resolved.publishableKey ? ['publishableKey'] : []),
    ]);
  }
  client = new RayfinClient<VazduhSchema, AppFunctionsSchema>({
    baseUrl: resolved.baseUrl,
    publishableKey: resolved.publishableKey,
    authStorage: true,
    runtimeConfig: resolved.runtimeConfig,
  });
  return client;
}

export function getRayfinClient(): VazduhClient {
  if (!client) {
    throw new Error('Rayfin klijent nije inicijalizovan. Prvo pozovite bootstrapAuth().');
  }
  return client;
}

export function hasRayfinClient(): boolean {
  return client !== null;
}
