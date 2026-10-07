import type { AuthConfigState, AuthUser, IAuthService } from './IAuthService';

export const DEMO_USER: AuthUser = {
  id: 'demo-user',
  email: 'demo@vazduh.local',
  name: 'Demo korisnik',
};

/**
 * Demo režim (VITE_SERVICE_MODE=demo): nema backenda ni prave prijave.
 * Koristi se samo za lokalni pregled izgleda i automatske snimke ekrana;
 * UI u ovom režimu uvek prikazuje oznaku „DEMO PODACI“.
 */
export class DemoAuthService implements IAuthService {
  readonly mode = 'demo' as const;
  readonly config: AuthConfigState = { kind: 'demo' };
  readonly canSignIn = true;

  async resolveSession(): Promise<AuthUser | null> {
    return DEMO_USER;
  }

  async signIn(): Promise<AuthUser> {
    return DEMO_USER;
  }

  async signOut(): Promise<void> {}
}
