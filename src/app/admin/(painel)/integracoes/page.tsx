import { IntegrationsForm } from "@/components/admin/IntegrationsForm";
import { requireAdmin } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata = { title: "Integrações" };

function hint(encrypted: string | null | undefined) {
  if (!encrypted) return null;
  try {
    return decryptSecret(encrypted).slice(-4);
  } catch {
    return "????";
  }
}

export default async function IntegrationsPage() {
  const { supabase, user } = await requireAdmin();
  const db = createServiceClient();
  const [{ data: cfg }, { data: secret }, { data: failed }] = await Promise.all([
    supabase.from("account_integrations").select("*").eq("owner_id", user.id).maybeSingle(),
    db.from("account_integration_secrets").select("meta_capi_token_encrypted, utmify_token_encrypted").eq("owner_id", user.id).maybeSingle(),
    supabase.from("orders").select("utmify_error").not("utmify_error", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  return (
    <>
      <h1 className="text-2xl font-semibold">Integrações</h1>
      <p className="mb-6 mt-1 text-sm text-gray-600">
        Valem para todos os produtos ativos desta conta. Um produto com Pixel próprio continua a usar o dele.
      </p>
      <IntegrationsForm
        metaTokenHint={hint(secret?.meta_capi_token_encrypted)}
        utmifyTokenHint={hint(secret?.utmify_token_encrypted)}
        lastUtmifyError={failed?.utmify_error ?? null}
        initial={{
          metaEnabled: cfg?.meta_enabled ?? false,
          pixelId: cfg?.meta_pixel_id ?? "",
          testEventCode: cfg?.meta_test_event_code ?? "",
          metaCurrency: cfg?.meta_currency ?? "AOA",
          metaRate: cfg?.meta_conversion_rate ? Number(cfg.meta_conversion_rate) : null,
          utmifyEnabled: cfg?.utmify_enabled ?? false,
          utmifyCurrency: cfg?.utmify_currency ?? "USD",
          utmifyRate: cfg?.utmify_conversion_rate ? Number(cfg.utmify_conversion_rate) : null,
        }}
      />
    </>
  );
}
