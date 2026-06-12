import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AnnouncerProvider } from './ui/Announcer'
import './styles.css'

if (import.meta.env.VITE_WDIO === '1') {
  void import('@wdio/tauri-plugin')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AnnouncerProvider>
      <App />
    </AnnouncerProvider>
  </React.StrictMode>,
)