import { CircleAlert, LoaderCircle } from 'lucide-react';
import { lazy, Suspense } from 'react';
import {
  BrowserRouter,
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useAuth } from '@/hooks/AuthContext';
import { reloadPage } from '@/lib/reload';
import { DashboardPage } from '@/pages/DashboardPage';
import { isDemoMode } from '@/services/bootstrap';

/** Stranica prijave je poseban JS deo – prijavljenom korisniku (Fabric) nije potrebna. */
const AuthPage = lazy(() => import('@/components/AuthPage').then((module) => ({ default: module.AuthPage })));

/** Ceo ekran „Učitavanje…“ (provera prijave, učitavanje stranice prijave). */
function FullPageLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-page text-ink" role="status" aria-live="polite">
      <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.12em] text-muted">
        <LoaderCircle aria-hidden className="spin size-4 text-accent" />
        Učitavanje…
      </div>
    </div>
  );
}

/** Ceo ekran kad se stranica prijave (poseban JS deo) ne preuzme – npr. prekid mreže. */
function FullPageError() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-page px-4 text-ink">
      <div role="alert" className="flex w-full max-w-sm flex-col items-start gap-3 rounded-panel border border-border-strong bg-panel-solid p-6 shadow-float">
        <span aria-hidden className="grid size-9 place-items-center rounded-full bg-danger-soft text-danger-soft-ink">
          <CircleAlert className="size-4" />
        </span>
        <div>
          <h1 className="text-lg font-semibold leading-6 text-ink">Stranica prijave nije učitana</h1>
          <p className="mt-1 text-sm leading-5 text-muted">Proverite vezu sa mrežom. Ponovni pokušaj ponovo učitava stranicu.</p>
        </div>
        <Button variant="primary" onClick={reloadPage}>
          Pokušaj ponovo
        </Button>
      </div>
    </div>
  );
}

/** The route a visitor asked for before being sent to sign in. */
interface AuthRedirectState {
  from?: string;
}

/**
 * Resolves where to send a visitor after they sign in.
 *
 * Only same-origin application paths are accepted, so a crafted value cannot
 * send the visitor off-site, and the sign-in route itself is rejected so
 * sign-in cannot loop.
 */
function resolveReturnPath(state: unknown): string {
  const from = (state as AuthRedirectState | null)?.from;

  if (typeof from !== 'string' || !from.startsWith('/')) return '/';
  if (from.startsWith('//') || from.startsWith('/\\')) return '/';
  if (
    from === '/auth' ||
    from.startsWith('/auth/') ||
    from.startsWith('/auth?')
  ) {
    return '/';
  }

  return from;
}

function AuthGuard({
  children,
  requireAuth,
}: {
  children: React.ReactNode;
  requireAuth: boolean;
}) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageLoader />;

  // Carry the requested route through sign-in. Without this, a shared link
  // opened by a signed-out visitor always lands on the default page.
  if (requireAuth && !isAuthenticated) {
    const redirectState: AuthRedirectState = {
      from: `${location.pathname}${location.search}`,
    };
    return <Navigate to="/auth" replace state={redirectState} />;
  }

  if (!requireAuth && isAuthenticated) {
    return <Navigate to={resolveReturnPath(location.state)} replace />;
  }

  return <>{children}</>;
}

/** Demo build se može hostovati i pod pod-putanjom (statički pregled), pa koristi hash rute. */
const Router = isDemoMode() ? HashRouter : BrowserRouter;

function App() {
  // `useTransitions={false}`: promena `?view=` se primenjuje sinhrono (flushSync) unutar
  // document.startViewTransition, pa animacija prelaza stranice snima pravo novo stanje.
  return (
    <Router useTransitions={false}>
      {/* ensure all new routes require auth */}
      <Routes>
        <Route
          path="/auth"
          element={
            <AuthGuard requireAuth={false}>
              <ErrorBoundary fallback={<FullPageError />}>
                <Suspense fallback={<FullPageLoader />}>
                  <AuthPage />
                </Suspense>
              </ErrorBoundary>
            </AuthGuard>
          }
        />
        <Route
          path="/"
          element={
            <AuthGuard requireAuth={true}>
              <DashboardPage />
            </AuthGuard>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
