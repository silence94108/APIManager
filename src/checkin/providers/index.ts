import type { SiteType } from "@/types";
import type { CheckinProvider } from "../types";
import { anyrouterProvider } from "./anyrouter";
import { newApiProvider } from "./newApi";
import { veloeraProvider } from "./veloera";
import { voapiV2Provider } from "./voapiV2";

const providers: Record<SiteType, CheckinProvider> = {
  "new-api": newApiProvider,
  veloera: veloeraProvider,
  anyrouter: anyrouterProvider,
  "voapi-v2": voapiV2Provider,
};

export function getProvider(siteType: SiteType): CheckinProvider {
  return providers[siteType];
}
