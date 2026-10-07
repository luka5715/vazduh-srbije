import type { OpaqueSession } from '@microsoft/rayfin-auth';
import {
  ensureSignedInWithFabric,
  initEmbeddedAuth as sdkInitEmbeddedAuth,
  signInWithBrokeredToken,
  type FabricAuthOptions,
} from '@microsoft/rayfin-auth-provider-fabric';

import { type AuthConfigState, type AuthUser, type IAuthService, toAuthUser } from './IAuthService';
import type { VazduhClient } from './rayfinClient';

function sessionUser(session: OpaqueSession | null | undefined): AuthUser | null {
  if (!session || !session.isAuthenticated || session.isAnonymous || !session.user) return null;
  return toAuthUser(session.user);
}

/**
 * Produkcijski sloj prijave: Fabric brokered authentication (Microsoft Entra ID SSO)
 * kroz `@microsoft/rayfin-auth-provider-fabric`. Radi i kad je aplikacija otvorena
 * unutar Fabric portala (iframe handoff) i samostalno (popup prijava).
 */
export class RayfinAuthService implements IAuthService {
  readonly mode = 'rayfin' as const;
  readonly config: AuthConfigState = { kind: 'ready' };
  readonly canSignIn = true;

  constructor(
    private readonly client: Pick<VazduhClient, 'auth'>,
    private readonly fabricOptions: FabricAuthOptions,
  ) {}

  async resolveSession(): Promise<AuthUser | null> {
    // 1. Ugrađeni režim (Fabric iframe): SDK prvo klasifikuje host i tek onda
    //    dozvoljava ponovno korišćenje sačuvane sesije — štiti od zastarelog
    //    identiteta prethodnog korisnika. Van iframe-a odmah vraća null.
    const embedded = await sdkInitEmbeddedAuth(this.client.auth, this.fabricOptions);
    if (embedded) return sessionUser(embedded);

    // 2. Sačuvana sesija iz prethodne posete.
    const current = this.client.auth.getSession();
    if (current.isAuthenticated && !current.isAnonymous) return sessionUser(current);
    if (current.isAnonymous) await this.client.auth.signOut();

    // 3. Tiho osvežavanje tokena.
    if (this.client.auth.hasRefreshToken()) {
      try {
        await this.client.auth.refreshSession();
        const refreshed = sessionUser(this.client.auth.getSession());
        if (refreshed) return refreshed;
      } catch {
        // nastavljamo na sledeći korak
      }
    }

    // 4. Lokalni razvoj: prijava preko Rayfin CLI-ja (`rayfin login`), samo u DEV
    //    bundle-u (dinamički import čuva produkcioni bundle od lokalnog endpointa).
    if (import.meta.env.DEV) {
      const localDev = await import('@microsoft/rayfin-local-dev');
      if (localDev.isRayfinLocalAutoLoginEnabled()) {
        const token = await localDev.fetchRayfinLocalSessionToken();
        if (!token) {
          throw new Error('Lokalna automatska prijava je uključena, ali nije dobijen token sesije.');
        }
        const session = await signInWithBrokeredToken(this.client.auth, token);
        return sessionUser(session);
      }
    }
    return null;
  }

  async signIn(): Promise<AuthUser> {
    if (this.client.auth.getSession().isAnonymous) await this.client.auth.signOut();
    const session = await ensureSignedInWithFabric(this.client.auth, this.fabricOptions);
    const user = sessionUser(session);
    if (!user) throw new Error('Fabric prijava je završena, ali sesija nije uspostavljena.');
    return user;
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  onSessionChange(listener: (user: AuthUser | null) => void): () => void {
    return this.client.auth.onSessionChange((session) => listener(sessionUser(session)));
  }
}

/** Zamena za pravi servis kad aplikacija nije konfigurisana; objašnjava zašto. */
export class UnconfiguredAuthService implements IAuthService {
  readonly mode = 'rayfin' as const;
  readonly canSignIn = false;

  constructor(readonly config: AuthConfigState) {}

  async resolveSession(): Promise<AuthUser | null> {
    return null;
  }

  async signIn(): Promise<AuthUser> {
    throw new Error('Prijava nije dostupna dok Rayfin backend nije konfigurisan (npx rayfin up).');
  }

  async signOut(): Promise<void> {}
}
