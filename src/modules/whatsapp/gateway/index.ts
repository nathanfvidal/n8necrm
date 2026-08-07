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
    // O NOME da variável entra à força, e não só `issue.message`. Quando o
    // valor é `undefined`, o Zod falha na checagem de tipo e nunca chega a
    // `.url()`/`.min()` — então a mensagem customizada acima não aparece, e o
    // que sobra é "Invalid input: expected string, received undefined", três
    // vezes, sem dizer qual variável. Foi exatamente o que o log de build da
    // Vercel mostrou em 2026-08-07, e descobrir quais faltavam exigiu ler o
    // rastreio de pilha até o módulo.
    const detalhes = resultado.error.issues
      .map((issue) => `${issue.path.join(".") || "(desconhecida)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Configuração do gateway de WhatsApp inválida: ${detalhes}`);
  }

  return resultado.data;
}

let instancia: WhatsappGateway | null = null;

/**
 * Constrói o gateway na PRIMEIRA USO, não ao importar o módulo.
 *
 * ## Por que preguiçoso, e não `const env = getGatewayEnv()` no topo
 *
 * Era assim, e derrubou o deploy de produção por três dias sem ninguém
 * perceber. `next build` avalia cada módulo alcançável para coletar a
 * configuração das rotas; a cadeia
 * `api/queues/whatsapp-turn` → `turno.ts` → `gateway/index.ts` fazia a
 * validação rodar em tempo de BUILD, onde variável de integração não tem por
 * que existir. Sem `EVOLUTION_*` na Vercel, o build inteiro falhava:
 *
 *     Failed to collect configuration for /api/queues/whatsapp-turn
 *     [cause]: Configuração do gateway de WhatsApp inválida: ...
 *
 * E falhava por completo — as telas de leads, o funil e o login não têm
 * relação nenhuma com a Evolution e paravam de ser publicados junto.
 *
 * O comentário do schema acima já declarava a intenção certa ("só quem
 * realmente importa o gateway precisa dessas variáveis"), mas chamar no
 * escopo do módulo a anulava: importar já era o bastante para lançar.
 * `fila.ts`, no mesmo módulo, sempre fez do jeito certo — `getSegredoFila()`
 * só roda dentro de quem publica na fila.
 *
 * A validação continua existindo e continua estrita: ela só mudou de momento.
 * Quem chamar o gateway sem as variáveis recebe o mesmo erro claro de antes,
 * agora em tempo de execução e afetando só o WhatsApp.
 */
function obterGateway(): WhatsappGateway {
  if (instancia) return instancia;

  const env = getGatewayEnv();

  // Troca de gateway (ex.: Fatia 5, Meta Cloud API) é trocar esta linha por
  // uma leitura de uma variável tipo WHATSAPP_GATEWAY, sem tocar em
  // ingest.ts, turno.ts ou nas rotas — nenhum dos dois conhece
  // `EvolutionGateway`, só a interface `WhatsappGateway`.
  instancia = new EvolutionGateway({
    domain: env.EVOLUTION_DOMAIN,
    instance: env.EVOLUTION_INSTANCE,
    apiKey: env.EVOLUTION_APIKEY,
  });

  return instancia;
}

/**
 * Mesma forma de sempre para quem consome — `whatsappGateway.enviarTexto(...)`
 * segue funcionando, e os mocks de teste que substituem este módulo continuam
 * valendo sem alteração. O Proxy existe só para adiar a construção até o
 * primeiro acesso a uma propriedade, que é o que separa "importar" de "usar".
 */
export const whatsappGateway: WhatsappGateway = new Proxy({} as WhatsappGateway, {
  get(_alvo, propriedade) {
    const real = obterGateway() as unknown as Record<string | symbol, unknown>;
    const valor = real[propriedade];
    return typeof valor === "function" ? valor.bind(real) : valor;
  },
});
