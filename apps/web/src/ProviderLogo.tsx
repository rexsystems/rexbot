import { providerInfo } from "@rex/shared";

/** Official provider marks, stored in public/providers (see docs/provider-logos.md). */
export function ProviderLogo({ provider, size = 40 }: { provider: string; size?: number }) {
  const info = providerInfo(provider);
  return (
    <span className="provider-logo" style={{ width: size, height: size, borderRadius: Math.round(size * 0.26) }} aria-hidden="true">
      {info.logo
        ? <img src={`/providers/${info.logo}`} alt="" width={Math.round(size * 0.56)} height={Math.round(size * 0.56)} draggable={false} />
        : <span className="provider-logo-letter" style={{ fontSize: Math.round(size * 0.42) }}>{info.id === "custom" ? "{ }" : info.name.slice(0, 1)}</span>}
    </span>
  );
}
