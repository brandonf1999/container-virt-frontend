import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ActivityLogProvider } from './state/activity-log.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ActivityLogProvider>
        <App />
      </ActivityLogProvider>
    </BrowserRouter>
  </StrictMode>,
)
