import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { I18nProvider } from './i18n'
import { StoreProvider, useStore } from './store'
import './styles.css'

/**
 * Reads the saved language and provides it to the whole tree. Sits inside the
 * store so the choice is available before anything renders.
 */
function LanguageGate({ children }: { children: React.ReactNode }): React.ReactNode {
  const { data } = useStore()
  return <I18nProvider language={data.settings.language}>{children}</I18nProvider>
}

const container = document.getElementById('root')
if (!container) throw new Error('Root container missing')

createRoot(container).render(
  <StrictMode>
    <StoreProvider>
      <LanguageGate>
        <App />
      </LanguageGate>
    </StoreProvider>
  </StrictMode>
)
