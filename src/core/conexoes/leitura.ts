import "server-only";

import type { CanalConexao } from "@prisma/client";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";
import { decifrar, PROPOSITO_APIKEY_CONEXAO } from "@/core/cofre";

import { hashWebhookToken } from "./webhook-token";

/**
 * As leituras que DECIFRAM — as únicas do sistema.
 *
 * Separadas de `./service.ts` de propósito: aquele arquivo serve a TELA e
 * jamais decifra; este serve o webhook e o envio, que precisam da credencial
 * de verdade para falar com a Evolution. A fronteira entre os dois é a
 * resposta a "isso pode voltar para o navegador?", e ela fica visível no
 * import em vez de depender de alguém lembrar de uma convenção.
 *
 * Nenhuma função aqui consulta o banco fora de `prismaDaEmpresa` — é o que
 * mantém a lista de exceções do lint em ZERO mesmo servindo o webhook, que
 * chega sem sessão. `tests/unit/catraca-prisma-cru.test.ts` é quem exercita
 * essa frase: ela reprova qualquer arquivo de `src/**` que importe
 * `@/lib/prisma` fora da lista declarada, e a lista está em zero.
 */

export class ConexaoNaoConfiguradaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ConexaoNaoConfiguradaError";
  }
}

export class ConexaoAmbiguaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ConexaoAmbiguaError";
  }
}

/**
 * Uma conexão com a credencial JÁ DECIFRADA. Este tipo nunca atravessa a
 * fronteira servidor→navegador: quem serve a tela é `ConexaoApresentada`
 * (`./service.ts`), que não tem `apiKey` nenhuma.
 */
export type CredencialDeConexao = {
  id: string;
  companyId: string;
  canal: CanalConexao;
  dominio: string | null;
  instancia: string | null;
  apiKey: string;
};

const CAMPOS = {
  id: true,
  companyId: true,
  canal: true,
  dominio: true,
  instancia: true,
  segredoCifrado: true,
} as const;

type LinhaCrua = {
  id: string;
  companyId: string;
  canal: CanalConexao;
  dominio: string | null;
  instancia: string | null;
  segredoCifrado: string;
};

function decifrarLinha(linha: LinhaCrua): CredencialDeConexao {
  const { segredoCifrado, ...resto } = linha;
  return {
    ...resto,
    // O erro do cofre sobe INTACTO. Capturá-lo aqui transformaria "a chave
    // mestra sumiu do ambiente" em "conexão não configurada", e esse sintoma
    // mandaria alguém recadastrar por cima de um segredo que continua lá.
    apiKey: decifrar(segredoCifrado, {
      companyId: linha.companyId,
      proposito: PROPOSITO_APIKEY_CONEXAO,
    }),
  };
}

/**
 * A resolução do WEBHOOK, e ela é o coração do ciclo.
 *
 * ## Como isto substitui `EVOLUTION_COMPANY_ID`
 *
 * O webhook chega sem sessão: não há de onde derivar empresa. A ponte antiga
 * (`ingest.ts`) lia uma variável de ambiente única do deploy — uma segunda
 * fonte de verdade sobre a conversa, ⚠️ R5 da auditoria do Ciclo 1a.
 *
 * Agora o `companyId` vem no PATH da rota, e ele é **hipótese, não
 * autoridade**: quem manda no resultado é o token, porque a busca é ESCOPADA.
 * O desenho é fecha-fechado, e cada linha tem caso de teste
 * (`tests/unit/conexoes-service.test.ts` e `conexoes-isolamento.test.ts`):
 *
 * - `companyId` de A + token de A → encontra. É a única combinação que passa.
 * - `companyId` de B + token de A → a busca escopada em B não acha o hash de
 *   A → `null`. **Saber o token da empresa A não dá nada na empresa B.**
 * - `companyId` inventado + token qualquer → `null`.
 *
 * Por isso um `companyId` de parâmetro aqui não viola a regra do programa. A
 * regra — "em Server Action a empresa vem de `usuarioAtual()`, nunca de
 * parâmetro" — existe porque Server Action TEM sessão, e aceitar a empresa por
 * parâmetro deixaria alguém autenticado agir na empresa alheia. Aqui não há
 * sessão nenhuma para contradizer, e o segredo é que decide.
 *
 * `findFirst` e não `findUnique`: o escopo RECUSA operação por chave única em
 * modelo de tenant (`core/tenancy/escopo.ts`, "Recusa, lançando"), e é bom que
 * recuse — um `findUnique({ where: { webhookTokenHash } })` seria escopável
 * pelo TIPO e não pela EMPRESA, devolvendo a linha de outra empresa a quem
 * soubesse o token.
 *
 * `ativa: true` faz parte do filtro: desativar uma conexão pela tela precisa
 * calar a ENTRADA também, não só a saída. Tem caso de teste.
 */
export async function resolverConexaoPorWebhook(
  companyId: string,
  token: string
): Promise<CredencialDeConexao | null> {
  const linha = await prismaDaEmpresa(companyId).whatsappConnection.findFirst({
    where: { webhookTokenHash: hashWebhookToken(token), ativa: true },
    select: CAMPOS,
  });

  return linha ? decifrarLinha(linha) : null;
}

/** A conexão de uma conversa que já sabe por onde entrou. */
export async function credencialDaConexao(
  companyId: string,
  connectionId: string
): Promise<CredencialDeConexao> {
  const linha = await prismaDaEmpresa(companyId).whatsappConnection.findFirst({
    where: { id: connectionId },
    select: CAMPOS,
  });

  if (!linha) {
    throw new ConexaoNaoConfiguradaError(
      `A conexão ${JSON.stringify(connectionId)} não existe na empresa ${JSON.stringify(companyId)}. ` +
        `Ou ela foi apagada em Configurações → Conexões, ou este id é de outra empresa.`
    );
  }

  return decifrarLinha(linha);
}

/**
 * A ÚNICA conexão ativa da empresa — para conversa criada antes do Ciclo 2a,
 * que não tem `connectionId`.
 *
 * "Nenhuma ativa" e "mais de uma ativa" são erros DIFERENTES de propósito: o
 * primeiro se resolve cadastrando, o segundo se resolve dizendo qual. Fundir
 * os dois numa mensagem obrigaria quem lesse a adivinhar qual dos dois
 * aconteceu.
 *
 * Mais de uma NUNCA escolhe "a primeira". Escolher em silêncio faria a empresa
 * responder o cliente pelo número errado — o mesmo gênero de vazamento
 * silencioso que `Company.findFirst()` produz, e que a regra do programa
 * proíbe por isso.
 */
export async function credencialAtivaUnica(
  companyId: string,
  contexto: string
): Promise<CredencialDeConexao> {
  const linhas = await prismaDaEmpresa(companyId).whatsappConnection.findMany({
    where: { ativa: true },
    select: CAMPOS,
  });

  if (linhas.length === 0) {
    throw new ConexaoNaoConfiguradaError(
      `A empresa ${JSON.stringify(companyId)} não tem nenhuma conexão de WhatsApp ativa (${contexto}). ` +
        `Cadastre uma em Configurações → Conexões. NÃO existe credencial padrão de ambiente: um ` +
        `padrão por deploy responderia clientes de uma empresa pela instância de outra, que é o ` +
        `vazamento silencioso que EVOLUTION_COMPANY_ID existia para evitar.`
    );
  }

  if (linhas.length > 1) {
    throw new ConexaoAmbiguaError(
      `A empresa ${JSON.stringify(companyId)} tem ${linhas.length} conexões ativas, e ${contexto} ` +
        `não registra por qual entrou (\`Conversation.connectionId\` nulo — conversa anterior ao ` +
        `Ciclo 2a). O envio RECUSA em vez de escolher: responder pelo número errado é pior que ` +
        `não responder. Saída: desative as conexões extras, ou defina o \`connectionId\` desta ` +
        `conversa.`
    );
  }

  return decifrarLinha(linhas[0]!);
}
