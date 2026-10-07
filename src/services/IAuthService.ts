/** Skraćeni prikaz prijavljenog korisnika za UI. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

/** Zašto aplikacija (ne) može da prijavi korisnika. */
export type AuthConfigState =
  | { readonly kind: 'ready' }
  /** Demo režim (VITE_SERVICE_MODE=demo): bez backenda, podaci su označeni kao demo. */
  | { readonly kind: 'demo' }
  /** Nema Fabric stavke: očekivano stanje pre prvog `npx rayfin up`. */
  | { readonly kind: 'not-deployed' }
  /** Nedostaju vrednosti konfiguracije (API URL, ključ …). */
  | { readonly kind: 'incomplete'; readonly missing: readonly string[] }
  /** `rayfin.config.json` postoji, ali se ne može pročitati. */
  | { readonly kind: 'config-error'; readonly message: string };

/**
 * Ugovor sloja prijave koji koristi React.
 *
 * - `RayfinAuthService` — produkcija i lokalni razvoj uz Fabric backend
 *   (Fabric SSO kroz `@microsoft/rayfin-auth-provider-fabric`).
 * - `DemoAuthService` — demo režim bez backenda (samo lokalno).
 * - `UnconfiguredAuthService` — aplikacija nije konfigurisana; objašnjava zašto.
 */
export interface IAuthService {
  readonly mode: 'rayfin' | 'demo';
  readonly config: AuthConfigState;
  /** Da li dugme „Prijavi se“ može da pokrene interaktivnu prijavu. */
  readonly canSignIn: boolean;

  /**
   * Tiho razrešava sesiju bez UI: ugrađeni Fabric handoff (iframe), sačuvana
   * sesija, osvežavanje tokena, lokalna CLI prijava u razvoju. `null` ako ništa
   * od toga ne da sesiju.
   */
  resolveSession(): Promise<AuthUser | null>;

  /**
   * Interaktivna prijava. Za Fabric otvara broker prozor, pa se MORA zvati
   * direktno iz handlera korisničkog gesta (klik).
   */
  signIn(): Promise<AuthUser>;

  signOut(): Promise<void>;

  /** Obaveštava o odjavi ili isteku sesije posle uspostavljanja. */
  onSessionChange?(listener: (user: AuthUser | null) => void): () => void;
}

export function toAuthUser(user: { id: string; email?: string | null; name?: string | null }): AuthUser {
  const email = user.email ?? '';
  return {
    id: user.id,
    email,
    name: user.name || (email ? email.split('@')[0] : 'Korisnik'),
  };
}
