"use client";

import { useSyncExternalStore } from "react";

/**
 * Quais cartões do funil o usuário deixou recolhidos.
 *
 * Primeiro caso de preferência de interface persistida no projeto. A decisão
 * do dono foi guardar POR NAVEGADOR (localStorage), não por usuário no banco:
 * é preferência de exibição, não dado do CRM — não vale uma coluna, uma
 * migração e uma escrita no Postgres a cada clique.
 *
 * Diferente do `useMontado` do `theme-toggle`, aqui a inscrição é DE VERDADE:
 * lá o valor muda uma vez (montou) e nunca mais; aqui muda a cada clique e em
 * qualquer aba aberta no mesmo navegador.
 *
 * ─── Decisão de auditoria: isto NÃO é limpo no logout (achado R1) ───
 *
 * A preferência sobrevive ao "Sair". Num computador compartilhado, quem sentar
 * depois consegue ler no DevTools os ids dos leads que a pessoa anterior estava
 * acompanhando. Foi avaliado e ACEITO, por três motivos, nesta ordem:
 *
 * 1. O que persiste é id opaco. Para fazer qualquer coisa com ele é preciso
 *    entrar no CRM — e quem entra já enxerga TODO lead, de qualquer papel (ver
 *    a decisão de negócio em `listarLeads`, em `core/leads/queries.ts`). O
 *    ganho de informação para o atacante é praticamente zero.
 * 2. `painel-nav.tsx` é Server Component. Limpar no logout exigiria puxar o
 *    controle de "Sair" para o cliente — fronteira nova no shell do painel,
 *    caro para o tamanho do problema.
 * 3. Decisivo: não cobriria quase nada. Sessão que expira, usuário desativado
 *    pelo ADMIN, segunda aba, aba fechada sem logout e o próprio `<form>`
 *    funcionando antes da hidratação — nenhum desses caminhos roda código de
 *    cliente. Seria uma limpeza que PARECE completa e não é, que é pior que a
 *    ausência documentada.
 *
 * O GATILHO para reabrir a decisão: no dia em que esta chave guardar qualquer
 * coisa que não seja id opaco — um termo de busca, um nome de cliente, um
 * valor, um filtro salvo — ela passa a vazar conteúdo, e aí precisa ser
 * escopada pelo id do usuário (comparado na leitura, descartando o que for de
 * outro) em vez de limpa no logout, justamente pelo motivo 3.
 */
const CHAVE = "crm:kanban:cartoes-recolhidos";

const VAZIO: ReadonlySet<string> = new Set();

const ouvintes = new Set<() => void>();

/**
 * Memo pela STRING crua, não pelo conteúdo.
 *
 * Reler o `localStorage` a cada `getSnapshot` é barato (leitura síncrona de
 * string); reanalisar o JSON a cada chamada não seria. Guardar o texto de
 * origem junto com o `Set` derivado dele dá o melhor dos dois e — o que
 * importa mais — dispensa invalidação de cache: se outra aba escreveu, a
 * string muda e a releitura acontece sozinha. Cache com invalidação manual é
 * onde este tipo de módulo costuma criar bug de "a tela não atualizou".
 */
let textoLido: string | null = null;
let derivado: ReadonlySet<string> = VAZIO;

function analisar(texto: string): ReadonlySet<string> {
  try {
    const conteudo: unknown = JSON.parse(texto);
    // JSON válido mas do tipo errado é tão provável quanto JSON quebrado
    // (uma versão futura que troque o formato, uma extensão do navegador,
    // um dedo no DevTools). `new Set(objeto)` lançaria "is not iterable" e
    // derrubaria o quadro inteiro — a mesma falha, por outro caminho.
    if (!Array.isArray(conteudo)) return VAZIO;
    return new Set(conteudo.filter((item): item is string => typeof item === "string"));
  } catch {
    return VAZIO;
  }
}

function ler(): ReadonlySet<string> {
  // Sem `window` não há preferência a ler. Vale para o servidor e para
  // qualquer chamada acidental fora do navegador.
  if (typeof window === "undefined") return VAZIO;

  let texto: string | null;
  try {
    texto = window.localStorage.getItem(CHAVE);
  } catch {
    // Alguns navegadores lançam só de TOCAR em `localStorage` (Safari em
    // navegação privada com cota zerada, políticas corporativas). Uma
    // preferência de exibição não pode derrubar o funil.
    return VAZIO;
  }

  if (texto === null) return VAZIO;
  if (texto === textoLido) return derivado;

  textoLido = texto;
  derivado = analisar(texto);
  return derivado;
}

/**
 * Devolve BOOLEAN, nunca o `Set`.
 *
 * O React chama `getSnapshot` a cada render e a cada notificação, e compara o
 * resultado com `Object.is`. Um `Set` novo a cada chamada seria sempre
 * "diferente": re-render infinito, com o aviso "The result of getSnapshot
 * should be cached to avoid an infinite loop". Um primitivo é estável por
 * construção, e ainda faz com que só o cartão alternado re-renderize — não os
 * outros 999 do quadro.
 */
export function estaRecolhido(leadId: string): boolean {
  return ler().has(leadId);
}

/**
 * Snapshot do servidor: a constante `false`, sem consultar nada.
 *
 * No servidor não existe `localStorage`, então qualquer valor que dependesse
 * dele divergiria da hidratação. E divergência aqui não é um piscar: é o
 * mesmo defeito que congelou o `aria-label` do alternador de tema — o React
 * não confere atributo durante a hidratação, adota o DOM do servidor e nunca
 * mais corrige. Um cartão recolhido apareceria expandido para sempre, com
 * `aria-expanded` mentindo para quem usa leitor de tela.
 *
 * Padrão EXPANDIDO, e não recolhido, também porque o e2e roda sem semear
 * `localStorage` e `arrastarComPonteiro` calcula o centro do cartão pelo
 * `boundingBox()`.
 */
export function snapshotDoServidor(): boolean {
  return false;
}

function avisar() {
  for (const ouvinte of ouvintes) ouvinte();
}

function aoMudarNoutraAba(evento: StorageEvent) {
  // `key === null` é o `localStorage.clear()` — atinge esta chave também.
  if (evento.key !== null && evento.key !== CHAVE) return;
  avisar();
}

/**
 * Inscrição única para todos os cartões: um `addEventListener` no total, não
 * um por cartão. Com o quadro no teto de 1000 leads, um ouvinte por cartão
 * seriam 1000 registros de `storage` fazendo exatamente o mesmo trabalho.
 */
export function inscrever(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  if (ouvintes.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", aoMudarNoutraAba);
  }
  return () => {
    ouvintes.delete(ouvinte);
    if (ouvintes.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", aoMudarNoutraAba);
    }
  };
}

export function alternarCartao(leadId: string) {
  const atual = ler();
  const proximo = new Set(atual);
  if (proximo.has(leadId)) {
    proximo.delete(leadId);
  } else {
    proximo.add(leadId);
  }

  try {
    window.localStorage.setItem(CHAVE, JSON.stringify([...proximo]));
  } catch {
    // Cota estourada ou armazenamento recusado. A preferência não gruda — o
    // cartão volta a aparecer expandido no próximo render — mas o quadro
    // continua de pé. Degradar é aceitável; derrubar não é.
    //
    // Não existe reserva em memória de propósito: ela faria a tela mostrar um
    // estado que o navegador não guardou, e o usuário descobriria a mentira
    // só no F5. YAGNI até alguém relatar.
  }
  avisar();
}

/**
 * `estaRecolhido` fecha sobre `leadId` a cada render — identidade nova toda
 * vez, e isso está certo: o React não memoriza `getSnapshot` por identidade,
 * só chama e compara o RESULTADO. Quem precisa ser estável é `inscrever`, que
 * é constante de módulo — se mudasse a cada render, cada render desmontaria e
 * remontaria a inscrição.
 */
export function useCartaoRecolhido(leadId: string): boolean {
  return useSyncExternalStore(inscrever, () => estaRecolhido(leadId), snapshotDoServidor);
}
