/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * 'rayfin' (podrazumevano) — pravi Fabric backend; 'demo' — bez backenda,
   * sa jasno označenim demo podacima za lokalni pregled i testove izgleda.
   */
  readonly VITE_SERVICE_MODE?: 'rayfin' | 'demo';
  /** Rayfin API base URL (upisuje `rayfin up` / `rayfin env`). */
  readonly VITE_RAYFIN_API_URL?: string;
  /** Rayfin publishable key (pk-...). */
  readonly VITE_RAYFIN_PUBLISHABLE_KEY?: string;
  /** Fabric workspace ID — FabricAuthOptions.workspaceId. */
  readonly VITE_FABRIC_WORKSPACE_ID?: string;
  /** Fabric item ID — FabricAuthOptions.projectId. */
  readonly VITE_FABRIC_ITEM_ID?: string;
  /** Fabric portal base URL (npr. https://app.fabric.microsoft.com/). */
  readonly VITE_FABRIC_PORTAL_URL?: string;
  readonly VITE_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
