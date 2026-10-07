import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuthProvider, useAuth } from '@/hooks/AuthContext';
import type { IAuthService } from '@/services/IAuthService';

const stubAuthService: IAuthService = {
  mode: 'demo',
  config: { kind: 'demo' },
  canSignIn: true,
  async resolveSession() {
    return { id: 'u1', email: 'dev@contoso.com', name: 'dev' };
  },
  async signIn() {
    return { id: 'u1', email: 'dev@contoso.com', name: 'dev' };
  },
  async signOut() {},
};

function Probe() {
  const { user, loading } = useAuth();
  return <div data-testid="content">{loading ? 'loading' : (user?.email ?? 'anonymous')}</div>;
}

describe('AuthProvider', () => {
  it('resolves the session once and exposes the user', async () => {
    render(
      <AuthProvider authService={stubAuthService}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('content')).toHaveTextContent('dev@contoso.com');
    });
  });
});
