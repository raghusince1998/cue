import React, { Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { AuthProvider } from './lib/auth.tsx'
import App from './App.tsx'
import { catchShare } from './lib/share.ts'
import './styles.css'

registerSW({ immediate: true })

// Shared in from another app: before routing, so /share never renders.
catchShare()

const container = document.getElementById('root')
if (!container) throw new Error('#root missing from index.html')

/**
 * The admin portal is a separate app: its own sign-in, session and layout.
 * Opened at /admin, the user app — and the user's session — never loads; only
 * this page downloads its code.
 */
const isAdmin = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/portal')
const AdminApp = lazy(() => import('./admin/AdminApp.tsx'))

createRoot(container).render(
  <React.StrictMode>
    <BrowserRouter>
      {isAdmin ? (
        <Suspense
          fallback={
            <div className="boot">
              <span className="spinner" />
            </div>
          }
        >
          <AdminApp />
        </Suspense>
      ) : (
        <AuthProvider>
          <App />
        </AuthProvider>
      )}
    </BrowserRouter>
  </React.StrictMode>,
)
