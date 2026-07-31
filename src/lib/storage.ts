import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export interface Storage {
  upload(path: string, file: Buffer, contentType: string): Promise<string>;
  delete(path: string): Promise<void>;
}

const BUCKET = "crm-arquivos";

// Validação isolada neste módulo (não em src/lib/env.ts): apenas quem
// realmente importa storage.ts precisa dessas variáveis. Se elas fossem
// exigidas no schema central, qualquer teste ou build que importe algo que
// dependa de env.ts (ex.: auth.ts, prisma.ts) passaria a exigir credenciais
// do Supabase mesmo sem usar armazenamento.
const storageEnvSchema = z.object({
  SUPABASE_URL: z.string().url({
    message: "SUPABASE_URL ausente ou inválida — defina no .env",
  }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, {
    message: "SUPABASE_SERVICE_ROLE_KEY ausente — defina no .env",
  }),
});

function getStorageEnv() {
  const resultado = storageEnvSchema.safeParse({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  if (!resultado.success) {
    const detalhes = resultado.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Configuração de storage inválida: ${detalhes}`);
  }

  return resultado.data;
}

class SupabaseStorage implements Storage {
  private client: ReturnType<typeof createClient>;

  constructor() {
    const env = getStorageEnv();
    this.client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  }

  async upload(path: string, file: Buffer, contentType: string): Promise<string> {
    const { error } = await this.client.storage.from(BUCKET).upload(path, file, {
      contentType,
      upsert: true,
    });
    if (error) throw new Error(`Falha no upload: ${error.message}`);

    const { data } = this.client.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async delete(path: string): Promise<void> {
    const { error } = await this.client.storage.from(BUCKET).remove([path]);
    if (error) throw new Error(`Falha ao remover: ${error.message}`);
  }
}

export const storage: Storage = new SupabaseStorage();
