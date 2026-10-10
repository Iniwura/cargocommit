import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ArtDirectedApp';
import './art-directed.css';
import './seldra-atelier.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
