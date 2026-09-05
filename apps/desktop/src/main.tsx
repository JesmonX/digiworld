import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@digiworld/design-system/tokens.css'
import '@digiworld/design-system/base.css'
import '@digiworld/typography/fonts.css'
import App from './App'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
