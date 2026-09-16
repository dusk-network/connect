// Compile against public exports after building; this file is never executed.
import { createDuskWallet, createDuskApp, DuskWalletRequestTimeoutError, type DuskProviderCapabilities } from "@dusk/connect";

createDuskApp({ pinnedNodeUrl: "https://node.example", wallet: { providerReadTimeoutMs: 20_000 } });
const timeout: Error = new DuskWalletRequestTimeoutError("dusk_profiles", 20_000);
// @ts-expect-error A pinned node URL must be a string.
createDuskApp({ pinnedNodeUrl: 42 });
// @ts-expect-error The read deadline is a number, not a duration string.
createDuskWallet({ providerReadTimeoutMs: "20s" });

declare const wallet: ReturnType<typeof createDuskWallet>;
const { features } = await wallet.getCapabilities();
const supportsTypedDataV1: boolean | undefined =
  features.signTypedData && features.signTypedDataVersions?.includes(1);
const versions: number[] | undefined = features.signTypedDataVersions;

// Older providers need not advertise either new capability.
const legacy: DuskProviderCapabilities["features"] = {
  shieldedRead: false,
  shieldedRecipients: true,
  signMessage: true,
  signAuth: true,
  contractCallPrivacy: true,
};
const advertised: DuskProviderCapabilities["features"] = {
  ...legacy,
  signTypedData: true,
  signTypedDataVersions: [1, 2],
};
advertised.signTypedData = false;
advertised.signTypedDataVersions = [];

// @ts-expect-error Signing support is a boolean, not a string.
advertised.signTypedData = "true";
// @ts-expect-error Supported versions are an array, not a scalar.
advertised.signTypedDataVersions = 1;
// @ts-expect-error Protocol versions are numbers, not strings.
advertised.signTypedDataVersions = ["1"];
