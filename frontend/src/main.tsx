import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { auth } from './lib/auth';

// Unregister any existing service workers (PWA cleanup)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister();
    }
  });
}

// Load user on app start - handle invalid tokens gracefully
if (auth.isAuthenticated()) {
  auth.loadUser().catch((error) => {
    // If loading fails (invalid token, user doesn't exist, etc.), clear tokens
    // The API interceptor will handle redirecting to login if needed
    if (error.response?.status === 401 || error.response?.status === 500) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
