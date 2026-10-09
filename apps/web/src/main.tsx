import React from 'react'
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

createRoot(container).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
