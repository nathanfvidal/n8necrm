import "server-only";

import type { CanalConexao } from "@prisma/client";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";
import { cifrar, PROPOSITO_APIKEY_CONEXAO } from "@/core/cofre";
import { registrarAuditoria } from "@/core/audit/log";
import { conferirDestino } from "./destino";

import { gerarWebhookToken, hashWebhookToken } from "./webhook-token";

/**
 * As escritas de conexão, e a leitura que serve a TELA.
 *
 * ## Este arquivo NUNCA decifra
 *
 * Quem decifra é `./leitura.ts`, que serve o webhook e o envio. A fronteira é
 * a resposta a "isso pode voltar para o navegador?", e ela fica visível no
 * import. Há caso de teste varrendo o retorno de `listarConexoes` por NOME de
 * chave e por CONTEÚDO — as duas metades, porque só uma deixaria passar o caso
 * oposto ("NÃO devolve nenhuma chave que carregue segredo", em
 * `tests/unit/conexoes-service.test.ts`).
 *
 * ## Auditoria SEM `antes` e SEM `depois` — em TODA ação, sem exceção
 *
 * Precedente literal: `redefinirSenha` (`core/users/service.ts`) audita
 * `acao`/`entidade`/`entidadeId` e mais nada.
 *
 * A regra vale inclusive para `criar` e `editar`, que só mexem em campo não
 * secreto, e vale por DERIVA: um `depois` legítimo hoje vira `{ ...conexao }`
 * amanhã, e aí o blob cifrado entra junto. A regra que ninguém erra é a que
 * não tem exceção. O caso "as seis ações auditam, e nenhuma carrega
 * instantâneo" (`tests/unit/conexoes-auditoria.test.ts`) exercita a palavra
 * "toda": ele percorre as SEIS ações que este arquivo produz e afirma a
 * ausência das duas chaves em cada uma.
 *
 * Há uma segunda razão, mecânica: a varredura de escopo recusa `companyId`
 * dentro de coluna `Json`, e `AuditLog.antes`/`depois` são exatamente as
 * colunas que "Falsos positivos conhecidos" (`core/tenancy/escopo.ts`) nomeia.
 * Um instantâneo de conexão carregaria `companyId` e seria recusado pelo
 * próprio escopo.
 */

export class ConexaoInvalidaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ConexaoInvalidaError";
  }
}

/** O que a TELA recebe. Note o que NÃO está aqui: nenhum segredo, nenhum hash. */
export type ConexaoApresentada = {
  id: string;
  canal: CanalConexao;
  nome: string;
  ativa: boolean;
  dominio: string | null;
  instancia: string | null;
  /** Já pronta, montada NO SERVIDOR — o cliente nunca deriva máscara de valor real. */
  mascara: string;
  segredoAtualizadoEm: Date;
  segredoAtualizadoPor: string | null;
};

const MAX_NOME = 80;

/**
 * Mínimo do segredo. Oito, não um: abaixo disso a máscara de 4 caracteres
 * revelaria metade do valor, e uma apikey de 3 caracteres é erro de digitação
 * (colou só um pedaço), não escolha de ninguém.
 */
const MIN_SEGREDO = 8;

/**
 * Oito pontos fixos + os 4 últimos. Fixo e não proporcional: o COMPRIMENTO da
 * apikey não é informação a publicar numa tela, e uma máscara proporcional o
 * publicaria a cada renderização.
 */
function montarMascara(ultimos4: string): string {
  return `${"•".repeat(8)}${ultimos4}`;
}

function validarNome(bruto: string): string {
  const nome = bruto.trim();
  if (nome.length === 0) throw new ConexaoInvalidaError("O nome da conexão é obrigatório.");
  if (nome.length > MAX_NOME) {
    throw new ConexaoInvalidaError(`O nome pode ter no máximo ${MAX_NOME} caracteres.`);
  }
  return nome;
}

function validarSegredo(bruto: string): string {
  // Só espaço nas PONTAS é removido — é o que sobra de uma colagem e o que um
  // header HTTP não aceita. Nada no miolo é tocado: apagar caractere de dentro
  // mudaria em silêncio o segredo que a pessoa acredita ter gravado, e o
  // sintoma seria "a chave está certa e não funciona".
  const segredo = bruto.replace(/^\s+|\s+$/g, "");
  if (segredo.length < MIN_SEGREDO) {
    throw new ConexaoInvalidaError(
      `A chave precisa ter pelo menos ${MIN_SEGREDO} caracteres — a que veio tem ${segredo.length}.`
    );
  }
  return segredo;
}

/**
 * Evolution exige domínio (URL) e instância. `META_CLOUD` é RECUSADO aqui: o
 * valor existe no enum para o Ciclo 2b não precisar de migração de enum
 * (mesmo motivo de `WhatsappAutor.HUMANO`), e recusar na escrita é o que
 * impede uma linha nascer com campos que nenhum gateway sabe usar.
 */
function validarCampos(
  canal: CanalConexao,
  dominio: string | null,
  instancia: string | null
): { dominio: string; instancia: string } {
  if (canal !== "EVOLUTION") {
    throw new ConexaoInvalidaError(
      `O canal ${canal} ainda não é atendido por este CRM — a Meta Cloud API é o Ciclo 2b.`
    );
  }

  // A regex que morreu aqui era `/^https?:\/\/[^\s/]+/`, e ela aceitava
  // `http://localhost:8080` e `http://169.254.169.254` — o endereço de
  // metadados das nuvens. Achado da auditoria de 2026-08-21, fora da checklist:
  // um ADMIN (que num sistema multiempresa é um CLIENTE, não quem opera a
  // infraestrutura) podia apontar a conexão para dentro da rede do servidor e
  // usar o CRM como proxy. O porquê de cada recusa está em `./destino`.
  const destino = conferirDestino(dominio ?? "");
  if (!destino.ok) throw new ConexaoInvalidaError(destino.motivo);

  const inst = (instancia ?? "").trim();
  if (inst.length === 0) {
    throw new ConexaoInvalidaError(
      "O nome da instância é obrigatório — é ele que o webhook confere contra o campo `instance` " +
        "de cada evento recebido."
    );
  }

  // Barra no fim produziria `//message/sendText` no envio. O adapter já apara
  // (`replace(/\/$/, "")`), mas aparar na GRAVAÇÃO evita que a tela mostre uma
  // coisa e o gateway use outra. Quem apara agora é `conferirDestino`.
  return { dominio: destino.url, instancia: inst };
}

/**
 * Os cinco caminhos de escrita por id passam por aqui: a linha existe E é
 * desta empresa. `criarConexao` não passa — ela não tem id para conferir.
 */
async function exigirConexaoDaEmpresa(companyId: string, id: string): Promise<string> {
  const linha = await prismaDaEmpresa(companyId).whatsappConnection.findFirst({
    where: { id },
    select: { id: true },
  });
  if (!linha) {
    // Mesma mensagem para "não existe" e "é de outra empresa", de propósito:
    // distinguir confirmaria, a quem sonda ids, que aquele cuid pertence a
    // alguém. É a política de `redefinirSenha`, palavra por palavra.
    throw new ConexaoInvalidaError("Conexão não encontrada.");
  }
  return linha.id;
}

export async function listarConexoes(companyId: string): Promise<ConexaoApresentada[]> {
  const linhas = await prismaDaEmpresa(companyId).whatsappConnection.findMany({
    // `select` explícito, nunca a linha inteira: o padrão do Prisma é devolver
    // TUDO, e um campo novo no schema entraria neste retorno sem ninguém pedir
    // — inclusive `segredoCifrado`.
    select: {
      id: true,
      canal: true,
      nome: true,
      ativa: true,
      dominio: true,
      instancia: true,
      segredoUltimos4: true,
      segredoAtualizadoEm: true,
      segredoAtualizadoPor: { select: { nome: true } },
    },
    orderBy: { criadoEm: "asc" },
  });

  return linhas.map((l) => ({
    id: l.id,
    canal: l.canal,
    nome: l.nome,
    ativa: l.ativa,
    dominio: l.dominio,
    instancia: l.instancia,
    mascara: montarMascara(l.segredoUltimos4),
    segredoAtualizadoEm: l.segredoAtualizadoEm,
    segredoAtualizadoPor: l.segredoAtualizadoPor?.nome ?? null,
  }));
}

export async function criarConexao(
  companyId: string,
  dados: {
    canal: CanalConexao;
    nome: string;
    dominio: string | null;
    instancia: string | null;
    segredo: string;
  },
  autorId: string
): Promise<{ id: string; webhookToken: string }> {
  const nome = validarNome(dados.nome);
  const segredo = validarSegredo(dados.segredo);
  const campos = validarCampos(dados.canal, dados.dominio, dados.instancia);

  // Gerado AQUI, no servidor, e devolvido UMA vez. É a única exceção nomeada à
  // regra "o segredo nunca volta para o navegador", e ela não é brecha: este
  // caminho não DECIFRA nada — entrega um valor que o servidor acabou de
  // sortear e guarda só o hash dele. Sem isso não haveria como a pessoa colar
  // a URL no painel da Evolution. O caso "devolve o token do webhook UMA vez,
  // e ele nunca volta por uma leitura" é o que amarra a palavra "uma".
  const webhookToken = gerarWebhookToken();

  const linha = await prismaDaEmpresa(companyId).whatsappConnection.create({
    data: {
      companyId,
      canal: dados.canal,
      nome,
      dominio: campos.dominio,
      instancia: campos.instancia,
      segredoCifrado: cifrar(segredo, { companyId, proposito: PROPOSITO_APIKEY_CONEXAO }),
      segredoUltimos4: segredo.slice(-4),
      segredoAtualizadoEm: new Date(),
      segredoAtualizadoPorId: autorId,
      webhookTokenHash: hashWebhookToken(webhookToken),
    },
    select: { id: true },
  });

  await auditar(companyId, autorId, "criar_conexao", linha.id);

  return { id: linha.id, webhookToken };
}

export async function substituirSegredo(
  companyId: string,
  id: string,
  segredoBruto: string,
  autorId: string
): Promise<void> {
  const alvo = await exigirConexaoDaEmpresa(companyId, id);
  const segredo = validarSegredo(segredoBruto);

  await prismaDaEmpresa(companyId).whatsappConnection.updateMany({
    where: { id: alvo },
    data: {
      segredoCifrado: cifrar(segredo, { companyId, proposito: PROPOSITO_APIKEY_CONEXAO }),
      segredoUltimos4: segredo.slice(-4),
      segredoAtualizadoEm: new Date(),
      segredoAtualizadoPorId: autorId,
    },
  });

  // O token do webhook NÃO é tocado, e há caso de teste para isso. São dois
  // segredos com ciclos de vida independentes: invalidar os dois juntos
  // obrigaria a recolar a URL no painel da Evolution a cada rotação de chave,
  // e o custo dessa fricção é gente deixando de rotacionar.
  await auditar(companyId, autorId, "substituir_segredo_conexao", alvo);
}

export async function atualizarConexao(
  companyId: string,
  id: string,
  dados: { nome: string; dominio: string | null; instancia: string | null },
  autorId: string
): Promise<void> {
  const alvo = await exigirConexaoDaEmpresa(companyId, id);
  const nome = validarNome(dados.nome);
  const campos = validarCampos("EVOLUTION", dados.dominio, dados.instancia);

  await prismaDaEmpresa(companyId).whatsappConnection.updateMany({
    where: { id: alvo },
    data: { nome, dominio: campos.dominio, instancia: campos.instancia },
  });

  await auditar(companyId, autorId, "editar_conexao", alvo);
}

export async function definirAtiva(
  companyId: string,
  id: string,
  ativa: boolean,
  autorId: string
): Promise<void> {
  const alvo = await exigirConexaoDaEmpresa(companyId, id);

  await prismaDaEmpresa(companyId).whatsappConnection.updateMany({
    where: { id: alvo },
    data: { ativa },
  });

  await auditar(companyId, autorId, ativa ? "ativar_conexao" : "desativar_conexao", alvo);
}

export async function regenerarWebhookToken(
  companyId: string,
  id: string,
  autorId: string
): Promise<{ webhookToken: string }> {
  const alvo = await exigirConexaoDaEmpresa(companyId, id);
  const webhookToken = gerarWebhookToken();

  await prismaDaEmpresa(companyId).whatsappConnection.updateMany({
    where: { id: alvo },
    data: { webhookTokenHash: hashWebhookToken(webhookToken) },
  });

  await auditar(companyId, autorId, "regenerar_webhook_conexao", alvo);

  return { webhookToken };
}

export async function apagarConexao(
  companyId: string,
  id: string,
  autorId: string
): Promise<void> {
  const alvo = await exigirConexaoDaEmpresa(companyId, id);

  await prismaDaEmpresa(companyId).whatsappConnection.deleteMany({ where: { id: alvo } });

  // `Conversation.connectionId` tem `ON DELETE SET NULL` (Tarefa 1): apagar a
  // conexão não apaga histórico de conversa, só desliga o vínculo. A conversa
  // órfã cai no caminho de `credencialAtivaUnica`, que RECUSA se houver mais
  // de uma ativa em vez de escolher.
  await auditar(companyId, autorId, "apagar_conexao", alvo);
}

/**
 * Um ponto só de auditoria, e ele NÃO aceita `antes`/`depois`. Não é
 * conveniência: é a forma de a regra não ter como ser burlada por descuido —
 * quem quisesse gravar um instantâneo teria de mudar esta assinatura, e a
 * mudança apareceria na revisão em vez de escorregar num spread.
 */
async function auditar(
  companyId: string,
  userId: string,
  acao: string,
  entidadeId: string
): Promise<void> {
  await registrarAuditoria({
    companyId,
    userId,
    acao,
    entidade: "WhatsappConnection",
    entidadeId,
  });
}
