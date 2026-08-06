import "server-only";

import { z } from "zod";

import { EvolutionGateway } from "./evolution";
import type { WhatsappGateway } from "./tipos";

export type { WhatsappGateway, EventoWhatsapp, TipoMensagemWhatsapp } from "./tipos";

// Validação isolada neste módulo, não em src/lib/env.ts — mesmo raciocínio
// de src/lib/storage.ts: só quem realmente importa o gateway do WhatsApp
// precisa dessas variáveis. Se elas fossem exigidas no schema central,
// qualquer teste ou build que importe algo que dependa de env.ts passaria a
// exigir credenciais da Evolution mesmo sem usar o módulo de WhatsApp.
const gatewayEnvSchema = z.object({
  EVOLUTION_DOMAIN: z.string().url({
    message: "EVOLUTION_DOMAIN ausente ou inválida — defina no .env (URL da sua instância Evolution)",
  }),
  EVOLUTION_INSTANCE: z.string().min(1, {
    message: "EVOLUTION_INSTANCE ausente — defina no .env (nome da instância pareada na Evolution)",
  }),
  EVOLUTION_APIKEY: z.string().min(1, {
    message: "EVOLUTION_APIKEY ausente — defina no .env (apikey da instância Evolution)",
  }),
});

function getGatewayEnv() {
  const resultado = gatewayEnvSchema.safeParse({
    EVOLUTION_DOMAIN: process.env.EVOLUTION_DOMAIN,
    EVOLUTION_INSTANCE: process.env.EVOLUTION_INSTANCE,
    EVOLUTION_APIKEY: process.env.EVOLUTION_APIKEY,
  });

  if (!resultado.success) {
    const detalhes = resultado.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Configuração do gateway de WhatsApp inválida: ${detalhes}`);
  }

  return resultado.data;
}

const env = getGatewayEnv();

// Troca de gateway (ex.: Fatia 5, Meta Cloud API) é trocar esta linha por
// uma leitura de uma variável tipo WHATSAPP_GATEWAY, sem tocar em
// ingest.ts, turno.ts ou nas rotas — nenhum dos dois conhece
// `EvolutionGateway`, só a interface `WhatsappGateway`.
export const whatsappGateway: WhatsappGateway = new EvolutionGateway({
  domain: env.EVOLUTION_DOMAIN,
  instance: env.EVOLUTION_INSTANCE,
  apiKey: env.EVOLUTION_APIKEY,
});
