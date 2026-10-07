import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { CustomerThemeProvider } from './components/CustomerThemeProvider'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CustomerThemeProvider>
      <App />
    </CustomerThemeProvider>
  </React.StrictMode>,
)
