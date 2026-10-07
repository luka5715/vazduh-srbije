import { createRoot } from 'react-dom/client';

import App from '@/App';
import { AuthProvider } from '@/hooks/AuthContext';
import { bootstrapAuth } from '@/services/bootstrap';
import { preloadView, viewFromLocation } from '@/views';

import './main.css';

// Stranice su posebni JS delovi: tražena se preuzima paralelno sa razrešavanjem prijave,
// ostale tek iz ljuske (posle prijave), kad je pregledač besposlen.
preloadView(viewFromLocation());

const authService = await bootstrapAuth();

createRoot(document.getElementById('root')!).render(
  <AuthProvider authService={authService}>
    <App />
  </AuthProvider>
);
