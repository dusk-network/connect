import type { DuskProvider, DuskProviderDetail, DuskProviderInfo } from "./types.js";

export const DUSK_REQUEST_PROVIDER_EVENT = "dusk:requestProvider";
export const DUSK_ANNOUNCE_PROVIDER_EVENT = "dusk:announceProvider";
export const DUSK_SELECTED_PROVIDER_STORAGE_KEY = "dusk.connect.selectedProvider";
export const DUSK_PROVIDER_INFO_FIELDS = ["uuid", "name", "icon", "rdns"] as const;

export type RequestDuskProvidersOptions = {
  /** How long to collect announcement events after dispatching the request event. Default: 40ms. */
  timeoutMs?: number;
  /** Abort the request early. */
  signal?: AbortSignal;
};

export type WaitForDuskProvidersOptions = {
  /** Max total wait time. Default: 2000ms. */
  timeoutMs?: number;
  /** Retry cadence. Default: 50ms. */
  intervalMs?: number;
};

export type DuskProviderDiscoveryListener = (detail: DuskProviderDetail) => void;

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cloneInfo(info: DuskProviderInfo): DuskProviderInfo {
  return {
    uuid: info.uuid,
    name: info.name,
    icon: info.icon,
    rdns: info.rdns,
  };
}

export function isDuskProvider(value: any): value is DuskProvider {
  return (
    value &&
    typeof value === "object" &&
    (value as any).isDusk === true &&
    typeof (value as any).request === "function" &&
    typeof (value as any).on === "function"
  );
}

export function isDuskProviderInfo(value: any): value is DuskProviderInfo {
  return (
    value &&
    typeof value === "object" &&
    trim((value as any).uuid).length > 0 &&
    trim((value as any).name).length > 0 &&
    typeof (value as any).icon === "string" &&
    trim((value as any).rdns).length > 0
  );
}

export function isDuskProviderDetail(value: any): value is DuskProviderDetail {
  return (
    value &&
    typeof value === "object" &&
    isDuskProviderInfo((value as any).info) &&
    isDuskProvider((value as any).provider)
  );
}

export function normalizeDuskProviderInfo(info: DuskProviderInfo): DuskProviderInfo {
  return {
    uuid: trim(info.uuid),
    name: trim(info.name),
    icon: String(info.icon ?? ""),
    rdns: trim(info.rdns).toLowerCase(),
  };
}

export function normalizeDuskProviderDetail(detail: DuskProviderDetail): DuskProviderDetail {
  return {
    info: normalizeDuskProviderInfo(detail.info),
    provider: detail.provider,
  };
}

export function makeDuskAnnounceProviderEvent(detail: DuskProviderDetail): CustomEvent<DuskProviderDetail> {
  return new CustomEvent<DuskProviderDetail>(DUSK_ANNOUNCE_PROVIDER_EVENT, {
    detail: normalizeDuskProviderDetail(detail),
  });
}

export function makeDuskRequestProviderEvent(): Event {
  return new Event(DUSK_REQUEST_PROVIDER_EVENT);
}

export function announceDuskProvider(detail: DuskProviderDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(makeDuskAnnounceProviderEvent(detail));
}

export function requestDuskProviders(opts: RequestDuskProvidersOptions = {}): Promise<DuskProviderDetail[]> {
  if (typeof window === "undefined") return Promise.resolve([]);

  const timeoutMs = Math.max(0, opts.timeoutMs ?? 40);

  return new Promise((resolve) => {
    const byId = new Map<string, DuskProviderDetail>();
    let timer = 0;

    const finish = () => {
      window.removeEventListener(DUSK_ANNOUNCE_PROVIDER_EVENT, onAnnounce as EventListener);
      if (timer) window.clearTimeout(timer);
      opts.signal?.removeEventListener("abort", finish);
      resolve(
        [...byId.values()]
          .map((detail) => ({ info: cloneInfo(detail.info), provider: detail.provider }))
          .sort((a, b) => a.info.name.localeCompare(b.info.name))
      );
    };

    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isDuskProviderDetail(detail)) return;
      const normalized = normalizeDuskProviderDetail(detail);
      if (!normalized.info.uuid) return;
      byId.set(normalized.info.uuid, normalized);
    };

    if (opts.signal?.aborted) {
      finish();
      return;
    }

    window.addEventListener(DUSK_ANNOUNCE_PROVIDER_EVENT, onAnnounce as EventListener);
    opts.signal?.addEventListener("abort", finish, { once: true });
    window.dispatchEvent(makeDuskRequestProviderEvent());

    if (timeoutMs === 0) {
      queueMicrotask(finish);
      return;
    }

    timer = window.setTimeout(finish, timeoutMs);
  });
}

export async function waitForDuskProviders(
  opts: WaitForDuskProvidersOptions = {}
): Promise<DuskProviderDetail[]> {
  const timeoutMs = opts.timeoutMs ?? 2_000;
  const intervalMs = opts.intervalMs ?? 50;

  const immediate = await requestDuskProviders({ timeoutMs: 0 });
  if (immediate.length || typeof window === "undefined" || timeoutMs <= 0) return immediate;

  const started = Date.now();

  for (;;) {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) return [];

    const details = await requestDuskProviders({ timeoutMs: Math.min(intervalMs, remaining) });
    if (details.length) return details;
  }
}

export function subscribeDuskProviders(
  listener: DuskProviderDiscoveryListener,
  options: { requestOnStart?: boolean } = {}
): () => void {
  if (typeof window === "undefined") return () => {};

  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!isDuskProviderDetail(detail)) return;
    listener(normalizeDuskProviderDetail(detail));
  };

  window.addEventListener(DUSK_ANNOUNCE_PROVIDER_EVENT, onAnnounce as EventListener);

  if (options.requestOnStart !== false) {
    window.dispatchEvent(makeDuskRequestProviderEvent());
  }

  return () => {
    window.removeEventListener(DUSK_ANNOUNCE_PROVIDER_EVENT, onAnnounce as EventListener);
  };
}
