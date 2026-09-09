import { TooltipLayer } from '@digiworld/design-system/react'
import React from'react';import{createRoot}from'react-dom/client';import'@digiworld/design-system/tokens.css';import'@digiworld/design-system/base.css';import App from'./App';import'./styles.css';createRoot(document.getElementById('root')!).render(<React.StrictMode><TooltipLayer /><App/></React.StrictMode>)
