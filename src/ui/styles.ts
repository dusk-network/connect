/**
 * Shared UI stylesheet for the connect button + modal.
 *
 * We keep this readable (not minified) and reuse it across UI components
 * to avoid duplicating tokens (fonts, colors, radii) and small resets.
 */
export const DCONNECT_UI_BASE_CSS = `
  :host, .dconnect-overlay {
    /*
      Namespaced theme tokens to avoid collisions with host dApps.
      You can override these on :root or on <dusk-connect-button>.
    */

    --dconnect-font-sans: "Sohne", ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
    --dconnect-font-mono: "Sohne Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;

    /* Dusk brand foundation */
    --dconnect-radius-sm: 4px;
    --dconnect-radius: 8px;
    --dconnect-radius-lg: 12px;

    --dconnect-background: #101010;
    --dconnect-foreground: #F2F0EB;

    --dconnect-card: #151518;
    --dconnect-card-foreground: #F2F0EB;

    --dconnect-popover: #1B1B1E;
    --dconnect-popover-foreground: #F2F0EB;

    --dconnect-primary: #71B1FF;
    --dconnect-primary-hover: #8EC3FF;
    --dconnect-primary-foreground: #101010;

    --dconnect-secondary: #151518;
    --dconnect-secondary-foreground: #F2F0EB;

    --dconnect-muted: #27272A;
    --dconnect-muted-foreground: #A8A5AF;

    --dconnect-accent: rgba(113, 177, 255, 0.14);
    --dconnect-accent-foreground: #71B1FF;

    --dconnect-destructive: #E37A7A;
    --dconnect-destructive-foreground: #101010;

    --dconnect-border: rgba(242, 240, 235, 0.10);
    --dconnect-border-strong: rgba(242, 240, 235, 0.22);
    --dconnect-input: #0C0C0E;
    --dconnect-ring: #71B1FF;

    --dconnect-ok: #6FBF8E;
    --dconnect-warn: #E8B96A;

    --dconnect-shadow: 0 16px 40px rgba(0, 0, 0, 0.52);
    --dconnect-shadow-soft: 0 4px 16px rgba(0, 0, 0, 0.36);
    --dconnect-shadow-hover: 0 18px 44px rgba(0, 0, 0, 0.58);

    /* SDK-specific derived tokens */
    --dconnect-overlay-bg: rgba(16, 16, 16, 0.72);
    --dconnect-radius-pill: 999px;
    --dconnect-shadow-focus: 0 0 0 4px rgba(113, 177, 255, 0.24);

    --dconnect-button-bg: #151518;
    --dconnect-button-border: rgba(242, 240, 235, 0.15);
    --dconnect-button-hover: #1B1B1E;
    --dconnect-control-primary-bg: #E2DFE9;
    --dconnect-control-primary-fg: #101010;
    --dconnect-control-primary-hover-bg: #EDEAF3;

    /*
      The default Dusk treatment is solid, not a gradient.
    */
    --dconnect-primary-gradient: var(--dconnect-primary);
    --dconnect-primary-gradient-hover: var(--dconnect-primary-hover);

    --dconnect-avatar-bg: rgba(113, 177, 255, 0.12);
    --dconnect-avatar-fg: var(--dconnect-primary);
    --dconnect-avatar-border: rgba(113, 177, 255, 0.22);
    --dconnect-avatar-gradient: var(--dconnect-avatar-bg);
    --dconnect-provider-icon-bg: var(--dconnect-muted);
    --dconnect-provider-icon-fg: var(--dconnect-foreground);
    --dconnect-provider-dusk-icon-fg: var(--dconnect-primary);
    --dconnect-logo-mark: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%201000%201000%22%3E%3Cpath%20d%3D%22M514%2C0.2c-36.9-1-72.9%2C2-107.5%2C8.5C175%2C52.4%2C0%2C255.8%2C0%2C500s175.1%2C447.5%2C406.6%2C491.3c30.2%2C5.8%2C61.5%2C8.8%2C93.4%2C8.8c282.9%2C0%2C510.9-235%2C499.6-520.4C989.2%2C218.7%2C775%2C7.2%2C514%2C0.2z%20M522.6%2C899.4c-8.5%2C0.5-14-9.2-8.7-16C596.1%2C777.5%2C645.2%2C644.5%2C645.2%2C500s-49-277.6-131.4-383.4c-5.2-6.8%2C0.1-16.5%2C8.6-16C733%2C112.3%2C900%2C286.6%2C900%2C500S733.1%2C887.6%2C522.6%2C899.4z%22%2F%3E%3C%2Fsvg%3E");

    --dconnect-ease: cubic-bezier(0.2, 0, 0, 1);
    --dconnect-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    --dconnect-dur-fast: 120ms;
    --dconnect-dur-base: 200ms;
    --dconnect-dur-slow: 360ms;
  }

  :host([theme="light"]),
  .dconnect-overlay[data-theme="light"] {
    color-scheme: light;

    --dconnect-background: #F7F6F3;
    --dconnect-foreground: #101010;

    --dconnect-card: #FFFFFF;
    --dconnect-card-foreground: #101010;

    --dconnect-popover: #FFFFFF;
    --dconnect-popover-foreground: #101010;

    --dconnect-primary: #71B1FF;
    --dconnect-primary-hover: #8EC3FF;
    --dconnect-primary-foreground: #101010;

    --dconnect-secondary: #FFFFFF;
    --dconnect-secondary-foreground: #101010;

    --dconnect-muted: #EDEAF3;
    --dconnect-muted-foreground: #636167;

    --dconnect-accent: rgba(113, 177, 255, 0.14);
    --dconnect-accent-foreground: #2F86E8;

    --dconnect-destructive: #C95050;
    --dconnect-destructive-foreground: #FFFFFF;

    --dconnect-border: rgba(16, 16, 16, 0.12);
    --dconnect-border-strong: rgba(16, 16, 16, 0.24);
    --dconnect-input: #FFFFFF;
    --dconnect-ring: #2F86E8;

    --dconnect-shadow: 0 18px 48px rgba(16, 16, 16, 0.16);
    --dconnect-shadow-soft: 0 5px 18px rgba(16, 16, 16, 0.10);
    --dconnect-shadow-hover: 0 18px 42px rgba(16, 16, 16, 0.18);
    --dconnect-shadow-focus: 0 0 0 4px rgba(47, 134, 232, 0.20);

    --dconnect-overlay-bg: rgba(16, 16, 16, 0.36);
    --dconnect-button-bg: #FFFFFF;
    --dconnect-button-border: rgba(16, 16, 16, 0.14);
    --dconnect-button-hover: #F1F0F4;
    --dconnect-control-primary-bg: #101010;
    --dconnect-control-primary-fg: #E2DFE9;
    --dconnect-control-primary-hover-bg: #1E1E22;

    --dconnect-avatar-bg: rgba(47, 134, 232, 0.12);
    --dconnect-avatar-fg: #2F86E8;
    --dconnect-avatar-border: rgba(47, 134, 232, 0.22);
    --dconnect-provider-icon-bg: #EDEAF3;
    --dconnect-provider-icon-fg: #101010;
    --dconnect-provider-dusk-icon-fg: #101010;
  }

  @media (prefers-color-scheme: light) {
    :host(:not([theme="dark"])),
    .dconnect-overlay:not([data-theme="dark"]) {
      color-scheme: light;

      --dconnect-background: #F7F6F3;
      --dconnect-foreground: #101010;

      --dconnect-card: #FFFFFF;
      --dconnect-card-foreground: #101010;

      --dconnect-popover: #FFFFFF;
      --dconnect-popover-foreground: #101010;

      --dconnect-primary: #71B1FF;
      --dconnect-primary-hover: #8EC3FF;
      --dconnect-primary-foreground: #101010;

      --dconnect-secondary: #FFFFFF;
      --dconnect-secondary-foreground: #101010;

      --dconnect-muted: #EDEAF3;
      --dconnect-muted-foreground: #636167;

      --dconnect-accent: rgba(113, 177, 255, 0.14);
      --dconnect-accent-foreground: #2F86E8;

      --dconnect-destructive: #C95050;
      --dconnect-destructive-foreground: #FFFFFF;

      --dconnect-border: rgba(16, 16, 16, 0.12);
      --dconnect-border-strong: rgba(16, 16, 16, 0.24);
      --dconnect-input: #FFFFFF;
      --dconnect-ring: #2F86E8;

      --dconnect-shadow: 0 18px 48px rgba(16, 16, 16, 0.16);
      --dconnect-shadow-soft: 0 5px 18px rgba(16, 16, 16, 0.10);
      --dconnect-shadow-hover: 0 18px 42px rgba(16, 16, 16, 0.18);
      --dconnect-shadow-focus: 0 0 0 4px rgba(47, 134, 232, 0.20);

      --dconnect-overlay-bg: rgba(16, 16, 16, 0.36);
      --dconnect-button-bg: #FFFFFF;
      --dconnect-button-border: rgba(16, 16, 16, 0.14);
      --dconnect-button-hover: #F1F0F4;
      --dconnect-control-primary-bg: #101010;
      --dconnect-control-primary-fg: #E2DFE9;
      --dconnect-control-primary-hover-bg: #1E1E22;

      --dconnect-avatar-bg: rgba(47, 134, 232, 0.12);
      --dconnect-avatar-fg: #2F86E8;
      --dconnect-avatar-border: rgba(47, 134, 232, 0.22);
      --dconnect-provider-icon-bg: #EDEAF3;
      --dconnect-provider-icon-fg: #101010;
      --dconnect-provider-dusk-icon-fg: #101010;
    }
  }

  @keyframes dconnect-panel-in {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.985);
    }

    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes dconnect-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes dconnect-panel-out {
    from {
      opacity: 1;
      transform: translateY(0) scale(1);
    }

    to {
      opacity: 0;
      transform: translateY(6px) scale(0.985);
    }
  }

  @keyframes dconnect-fade-out {
    from { opacity: 1; }
    to { opacity: 0; }
  }

  @keyframes dconnect-logo-pulse {
    0%, 100% { transform: scale(1); }
    45% { transform: scale(1.08); }
  }

  /* Lightweight box-sizing reset (scoped) */
  :host, :host * {
    box-sizing: border-box;
  }

  .dconnect-overlay, .dconnect-overlay * {
    box-sizing: border-box;
  }

  @media (prefers-reduced-motion: reduce) {
    :host *,
    :host *::before,
    :host *::after,
    .dconnect-overlay,
    .dconnect-overlay *,
    .dconnect-overlay *::before,
    .dconnect-overlay *::after {
      animation-duration: 1ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 1ms !important;
      scroll-behavior: auto !important;
    }
  }
`;
