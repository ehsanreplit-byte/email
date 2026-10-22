import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const container = document.getElementById('root')!;
// deploy-marker: eitaa page restored to the original phone flow


createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Remove the static boot placeholder as soon as the app is on screen.
const removeBootFallback = () => {
  const el = document.getElementById('boot-fallback');
  if (el) {
    el.style.transition = 'opacity .2s ease';
    el.style.opacity = '0';
    window.setTimeout(() => el.remove(), 220);
  }
};

if (container.childElementCount > 0) {
  removeBootFallback();
} else {
  const observer = new MutationObserver(() => {
    if (container.childElementCount > 0) {
      observer.disconnect();
      removeBootFallback();
    }
  });
  observer.observe(container, { childList: true });
  // Safety net: never keep the overlay forever if the tree mounted elsewhere.
  window.setTimeout(() => {
    observer.disconnect();
    removeBootFallback();
  }, 10000);
}
