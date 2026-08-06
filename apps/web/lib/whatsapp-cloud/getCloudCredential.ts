import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

export interface CloudCredential {
  id: string;
  waba_id: string;
  phone_number_id: string;
  access_token: string;
}

/**
 * Único leitor pretendido de whatsapp_cloud_credentials.access_token — RLS
 * é deny-all na tabela, então isso só funciona com o admin client
 * (service-role). Nunca expor o retorno inteiro ao client.
 */
export async function getCloudCredential(tenantId: string): Promise<CloudCredential | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_cloud_credentials")
    .select("id, waba_id, phone_number_id, access_token")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    console.error("getCloudCredential: falha ao consultar whatsapp_cloud_credentials", error);
    return null;
  }

  return data;
}
