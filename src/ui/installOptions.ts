export type DuskWalletInstallPlatform = "chromium" | "firefox" | "unknown";
type DuskWalletInstallLinkPlatform = Exclude<DuskWalletInstallPlatform, "unknown">;

type DuskWalletInstallOption = {
  id: string;
  name: string;
  description: string;
  iconUrl?: string;
  links: Partial<Record<DuskWalletInstallLinkPlatform, string>>;
};

export type DuskWalletInstallTarget = {
  id: string;
  name: string;
  description: string;
  iconUrl?: string;
  platform: DuskWalletInstallPlatform;
  platformLabel: string;
  url: string;
};

export type GetDuskWalletInstallTargetsOptions = {
  userAgent?: string;
  platform?: DuskWalletInstallPlatform;
};

export const DUSK_WALLET_CHROMIUM_URL =
  "https://chromewebstore.google.com/detail/dusk-wallet/gcbboponngpmioapekmkajmffefaacld";
export const PIEWALLET_CHROMIUM_URL =
  "https://chromewebstore.google.com/detail/piewallet/fpaajdmdhkhfedemboncmcmckkhnnike";
export const PIEWALLET_ICON_URL =
  "https://lh3.googleusercontent.com/wf431HEp_WDmR_fXfquOToscVz3I9HJg2ROrwsAKuBSRqYTrfr7sEvhU2pSAgNxG0bvYZVta9jpyIMreVIH-FLKXmgs=s60";
export const DUSK_WALLET_FIREFOX_URL =
  "https://addons.mozilla.org/en-US/firefox/addon/dusk-wallet/";

const DUSK_WALLET_INSTALL_OPTIONS: readonly DuskWalletInstallOption[] = [
  {
    id: "dusk-wallet",
    name: "Dusk Wallet",
    description: "Official Dusk browser wallet.",
    links: {
      chromium: DUSK_WALLET_CHROMIUM_URL,
      firefox: DUSK_WALLET_FIREFOX_URL,
    },
  },
  {
    id: "piewallet",
    name: "Piewallet",
    description: "Official Pieswap wallet for DuskDS & DuskEVM.",
    iconUrl: PIEWALLET_ICON_URL,
    links: {
      chromium: PIEWALLET_CHROMIUM_URL,
    },
  },
];

export function detectDuskWalletInstallPlatform(userAgent?: string): DuskWalletInstallPlatform {
  const ua =
    userAgent ??
    (typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
      ? navigator.userAgent
      : "");
  const normalized = ua.toLowerCase();

  if (normalized.includes("firefox/") || normalized.includes("fxios/")) {
    return "firefox";
  }

  if (
    normalized.includes("chrome/") ||
    normalized.includes("chromium/") ||
    normalized.includes("crios/") ||
    normalized.includes("edg/") ||
    normalized.includes("opr/") ||
    normalized.includes("samsungbrowser/")
  ) {
    return "chromium";
  }

  return "unknown";
}

export function getDuskWalletInstallTargets(
  input: GetDuskWalletInstallTargetsOptions = {}
): DuskWalletInstallTarget[] {
  const platform = input.platform ?? detectDuskWalletInstallPlatform(input.userAgent);
  const platforms: readonly DuskWalletInstallLinkPlatform[] =
    platform === "unknown" ? ["chromium", "firefox"] : [platform];
  const seenUrls = new Set<string>();
  const targets: DuskWalletInstallTarget[] = [];

  for (const option of DUSK_WALLET_INSTALL_OPTIONS) {
    for (const linkPlatform of platforms) {
      const url = option.links[linkPlatform]?.trim();
      if (!url || seenUrls.has(url)) continue;

      seenUrls.add(url);
      const target: DuskWalletInstallTarget = {
        id: `${option.id}-${linkPlatform}`,
        name: option.name,
        description: option.description,
        platform: linkPlatform,
        platformLabel: platformLabel(linkPlatform),
        url,
      };
      const iconUrl = option.iconUrl?.trim();
      if (iconUrl) target.iconUrl = iconUrl;
      targets.push(target);
    }
  }

  return targets;
}

function platformLabel(platform: DuskWalletInstallLinkPlatform): string {
  return platform === "firefox" ? "Firefox" : "Chromium";
}
