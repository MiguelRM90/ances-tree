import { defineConfig } from 'vite';

/**
 * The CSP is injected from here rather than written by hand into index.html,
 * because dev and production need different policies:
 *
 *  - In dev, Vite injects CSS as <style> from JS and opens a WebSocket for HMR.
 *    That needs 'unsafe-inline' in style-src and ws: in connect-src.
 *  - In production the CSS is a file and there is no WebSocket, so the policy
 *    can be strict for real.
 *
 * See decisions.md, Content Security Policy. Reminder: GitHub Pages serves no
 * HTTP headers, so frame-ancestors and report-uri are simply not available.
 */
const CSP_PROD = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const CSP_DEV = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspPlugin() {
  return {
    name: 'ancestree-csp',
    transformIndexHtml(html, ctx) {
      const policy = ctx.server ? CSP_DEV : CSP_PROD;
      return html.replace('%CSP%', policy);
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the project under /ances-tree/. Without this, assets
  // resolve against the domain root and never load.
  base: '/ances-tree/',
  plugins: [cspPlugin()],
  build: {
    target: 'esnext',
    modulePreload: { polyfill: false },
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
