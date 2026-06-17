import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode removed: React's double-mount in dev mode destroys the PixiJS
// WebGL context before the second mount, causing a blank canvas.
createRoot(document.getElementById('root')!).render(<App />)
