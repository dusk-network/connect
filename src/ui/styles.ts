/**
 * Shared UI stylesheet for the connect button + modal.
 *
 * We keep this readable (not minified) and reuse it across UI components
 * to avoid duplicating tokens (fonts, colors, radii) and small resets.
 */
export const MCONNECT_UI_BASE_CSS = `
  :host, .mconnect-overlay {
    /*
      Namespaced theme tokens to avoid collisions with host dApps.
      You can override these on :root or on <mochavi-connect-button>.
    */

    --mconnect-font-sans: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
    --mconnect-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;

    /* Base theme (mirrors the wallet UI) */
    --mconnect-radius: 14px;

    --mconnect-background: #05070c;
    --mconnect-foreground: rgba(255, 255, 255, 0.92);

    --mconnect-card: rgba(255, 255, 255, 0.04);
    --mconnect-card-foreground: rgba(255, 255, 255, 0.92);

    --mconnect-popover: rgba(0, 0, 0, 0.18);
    --mconnect-popover-foreground: rgba(255, 255, 255, 0.92);

    --mconnect-primary: #7aa2ff;
    --mconnect-primary-foreground: rgba(255, 255, 255, 0.94);

    --mconnect-secondary: rgba(0, 0, 0, 0.16);
    --mconnect-secondary-foreground: rgba(255, 255, 255, 0.85);

    --mconnect-muted: rgba(0, 0, 0, 0.16);
    --mconnect-muted-foreground: rgba(255, 255, 255, 0.62);

    --mconnect-accent: rgba(122, 162, 255, 0.12);
    --mconnect-accent-foreground: rgba(255, 255, 255, 0.92);

    --mconnect-destructive: #ff4d6d;
    --mconnect-destructive-foreground: rgba(255, 255, 255, 0.92);

    --mconnect-border: rgba(255, 255, 255, 0.08);
    --mconnect-input: rgba(255, 255, 255, 0.10);
    --mconnect-ring: #33d1ff;

    --mconnect-ok: #2ee59d;
    --mconnect-warn: #ffcc66;

    --mconnect-shadow: 0 14px 40px rgba(0, 0, 0, 0.35);
    --mconnect-shadow-soft: 0 10px 30px rgba(0, 0, 0, 0.22);

    /* SDK-specific derived tokens */
    --mconnect-overlay-bg: rgba(0, 0, 0, 0.55);
    --mconnect-radius-pill: 999px;
    --mconnect-shadow-focus: 0 0 0 3px rgba(51, 209, 255, 0.30);

    --mconnect-button-bg: rgba(0, 0, 0, 0.18);
    --mconnect-button-border: rgba(255, 255, 255, 0.10);
    --mconnect-button-hover: rgba(255, 255, 255, 0.06);

    --mconnect-primary-gradient: linear-gradient(
      90deg,
      rgba(122, 162, 255, 0.35),
      rgba(51, 209, 255, 0.25)
    );
    --mconnect-primary-gradient-hover: linear-gradient(
      90deg,
      rgba(122, 162, 255, 0.42),
      rgba(51, 209, 255, 0.32)
    );

    --mconnect-avatar-gradient: linear-gradient(
      135deg,
      var(--mconnect-primary),
      var(--mconnect-ring)
    );
  }

  /* Lightweight box-sizing reset (scoped) */
  :host, :host * {
    box-sizing: border-box;
  }

  .mconnect-overlay, .mconnect-overlay * {
    box-sizing: border-box;
  }
`;
