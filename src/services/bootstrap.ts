import { DemoAuthService } from './DemoAuthService';
import type { IAuthService } from './IAuthService';
import { RayfinAuthService, UnconfiguredAuthService } from './RayfinAuthService';
import { initRayfinClient, MissingRayfinConfigError } from './rayfinClient';

export function isDemoMode(): boolean {
  return import.meta.env.VITE_SERVICE_MODE === 'demo';
}

/**
 * Bira sloj prijave pri startu aplikacije (pre nego što React renderuje).
 * Nikad ne baca: svaka greška konfiguracije postaje stanje koje UI objašnjava.
 *
 * - `VITE_SERVICE_MODE=demo` → {@link DemoAuthService} bez backenda.
 * - inače → Rayfin klijent (runtime `rayfin.config.json` + `VITE_*` podrazumevano)
 *   i {@link RayfinAuthService} sa Fabric SSO.
 */
export async function bootstrapAuth(): Promise<IAuthService> {
  if (isDemoMode()) return new DemoAuthService();

  let client;
  try {
    client = await initRayfinClient({
      apiUrl: import.meta.env.VITE_RAYFIN_API_URL,
      publishableKey: import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY,
      workspaceId: import.meta.env.VITE_FABRIC_WORKSPACE_ID,
      itemId: import.meta.env.VITE_FABRIC_ITEM_ID,
      portalUrl: import.meta.env.VITE_FABRIC_PORTAL_URL,
    });
  } catch (error) {
    if (error instanceof MissingRayfinConfigError) {
      return new UnconfiguredAuthService({ kind: 'incomplete', missing: error.missing });
    }
    return new UnconfiguredAuthService({
      kind: 'config-error',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  // Fabric koordinate postoje tek posle prvog `rayfin up`.
  const { workspaceId, itemId: projectId, portalUrl: fabricPortalUrl } = client.runtimeConfig ?? {};
  if (!workspaceId || !projectId || !fabricPortalUrl) {
    return new UnconfiguredAuthService({ kind: 'not-deployed' });
  }

  return new RayfinAuthService(client, {
    workspaceId,
    projectId,
    fabricPortalUrl,
    returnOrigin: window.location.origin,
  });
}
