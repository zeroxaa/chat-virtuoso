import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Harness from './Harness.tsx'

const isHarness =
  new URLSearchParams(window.location.search).get('harness') === '1';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isHarness ? <Harness /> : <App />}</StrictMode>,
)
