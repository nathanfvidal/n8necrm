import { NextResponse } from "next/server";
import type { LeadChannel } from "@prisma/client";

import { usuarioAtual } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { listarLeads } from "@/core/leads/queries";

// Mesma rotulagem de canal do card do kanban (kanban-card.tsx, Task 15) e da
// tabela (lead-table.tsx, Task 16) — mantida em sincronia de propósito para
// que o mesmo lead apareça com o mesmo texto de canal em qualquer lugar,
// inclusive nesta exportação. Cada lugar guarda sua própria cópia (mesmo
// padrão dos outros dois arquivos) porque não existe hoje um módulo
// compartilhado para isso — três cópias pequenas em sincronia por comentário
// é a convenção já estabelecida neste código, não uma nova.
const rotuloCanal: Record<LeadChannel, string> = {
  FORMULARIO: "Formulário",
  WHATSAPP: "WhatsApp",
  MANUAL: "Manual",
};

/**
 * Formata `Contact.telefone` (sempre DDD + 8/9 dígitos, sem código de país —
 * ver `normalizarTelefone`, dedupe.ts) como "(DD) NNNNN-NNNN" em vez de
 * exportar o dígito cru.
 *
 * Dois problemas do Excel motivam isto, não um só:
 *
 * 1. Um DDD brasileiro nunca começa em "0", então a exportação não perde
 *    zero à esquerda de verdade neste domínio — mas 10-11 dígitos SEM
 *    formatação, numa célula estreita, ainda caem na heurística do Excel que
 *    reformata número comprido como notação científica (1,1999900001E+10) ao
 *    abrir o CSV. O valor por baixo continua correto (11 dígitos cabe dentro
 *    da precisão de 15 dígitos do Excel), mas é ilegível sem redimensionar a
 *    coluna — ruim o bastante numa exportação que existe para ser lida.
 * 2. Formatos futuros de telefone (Fase 2, campo público) podem não ter essa
 *    garantia do domínio atual.
 *
 * A correção mais simples que resolve os dois problemas de uma vez: um valor
 * que começa com "(" nunca é interpretado como número pelo Excel — texto
 * puro, sem heurística nenhuma — e de quebra fica mais legível para quem for
 * olhar a planilha. Preferido a alternativas como prefixar com fórmula
 * (`="...""`) que reintroduziriam risco de injeção via o próprio telefone
 * (dado que também vem de formulário público na Fase 2).
 */
function formatarTelefoneExibicao(telefone: string): string {
  const digitos = telefone.replace(/\D/g, "");
  if (digitos.length === 11) {
    return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  }
  if (digitos.length === 10) {
    return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  }
  // Formato inesperado — não deveria acontecer, pois todo `Contact.telefone`
  // é gravado por `encontrarOuCriarContact` (dedupe.ts) já normalizado neste
  // formato. Preferimos exportar o valor cru a quebrar a exportação inteira
  // por causa de um único contato com dado fora do padrão.
  return telefone;
}

/**
 * Formata `Lead.criadoEm` (um `DateTime` do Postgres, sempre UTC) como
 * "DD/MM/AAAA HH:mm" no fuso de São Paulo — em vez do ISO 8601 cru do
 * rascunho original desta rota.
 *
 * Fuso fixado explicitamente em "America/Sao_Paulo" (não
 * `toLocaleString` sem `timeZone`, que herdaria o fuso do processo Node):
 * o servidor de produção não necessariamente roda no fuso do Brasil, e um
 * horário de criação que muda dependendo de onde o processo está hospedado
 * seria pior que inútil numa exportação que existe para auditoria.
 * `Intl.DateTimeFormat` + `formatToParts` (em vez de `toLocaleString`
 * direto) evita o "," que o locale pt-BR insere entre data e hora por
 * padrão — controle explícito do formato final, sem depender de como a ICU
 * do ambiente formata `toLocaleString` hoje.
 */
function formatarDataHoraExibicao(data: Date): string {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(data);

  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${valor("day")}/${valor("month")}/${valor("year")} ${valor("hour")}:${valor("minute")}`;
}

/**
 * Escapa um campo para uma linha de CSV lido no Excel — o rascunho original
 * desta rota (task-21-brief.md) só tratava vírgula/aspas/quebra de linha, o
 * que não é suficiente para dois problemas reais que o brief pede para
 * corrigir:
 *
 * 1. **Delimitador**: esta função escapa em torno de `;` (ver `DELIMITADOR`
 *    abaixo), não `,` — Excel em locale pt-BR usa `,` como separador
 *    decimal, então a configuração regional do Windows troca o "separador de
 *    lista" padrão do CSV de `,` para `;`. Ao dar duplo-clique num `.csv`
 *    delimitado por vírgula, o Excel pt-BR não separa colunas — a linha
 *    inteira cai numa célula só. `;` é o delimitador que o Excel pt-BR
 *    espera por padrão.
 * 2. **Injeção de fórmula (CSV injection)**: um campo cujo primeiro
 *    caractere é `=`, `+`, `-`, `@`, tab ou retorno de carro é interpretado
 *    pelo Excel/LibreOffice como início de fórmula ao abrir o arquivo — não
 *    como texto literal. `Contact.nome` (e, por composição, qualquer outro
 *    campo de texto desta exportação, por simetria e porque é barato demais
 *    para pular) é dado que, a partir da Fase 2, chega de um formulário
 *    público na web — ou seja, um agente de fora do CRM decide o que vai
 *    nessa célula. Um nome digitado como `=HYPERLINK("http://evil","clique
 *    aqui")` ou `=cmd|'/c calc'!A1` abriria como fórmula executável para
 *    quem exportar e abrir no Excel — exatamente o cenário que a mitigação
 *    padrão da OWASP (prefixar com um apóstrofo os campos que começam com
 *    esse conjunto de caracteres) neutraliza: o Excel exibe o apóstrofo como
 *    marcador de "isto é texto", não como caractere visível, e o conteúdo
 *    aparece literal. Compensação aceita: outra ferramenta (Google Sheets,
 *    Numbers) que não reconheça essa convenção mostraria o apóstrofo como
 *    caractere literal — cosmético, e um preço baixo por não executar código
 *    arbitrário no Excel de quem exportou.
 *
 * BOM UTF-8 (`﻿`) é responsabilidade de quem monta o corpo completo do
 * CSV (função `GET` abaixo), não desta função por campo — sem ele, Excel
 * pt-BR assume Windows-1252 para abrir o arquivo e "São", "João",
 * "Conceição" viram mojibake ("SÃ£o", "JoÃ£o").
 */
const DELIMITADOR = ";";

function escaparCampoCsv(valor: string): string {
  const neutralizado = /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;

  if (
    neutralizado.includes(DELIMITADOR) ||
    neutralizado.includes('"') ||
    neutralizado.includes("\n") ||
    neutralizado.includes("\r")
  ) {
    return `"${neutralizado.replace(/"/g, '""')}"`;
  }
  return neutralizado;
}

function linhaCsv(campos: string[]): string {
  return campos.map(escaparCampoCsv).join(DELIMITADOR);
}

/**
 * `GET /export/leads` — exporta todo lead em CSV para quem tem a permissão
 * `exportar_leads` (ADMIN e GESTOR — ver matriz em `core/auth/permissions.ts`;
 * VENDEDOR não tem).
 *
 * Esta rota mora sob o route group `(painel)`, mas `(painel)/layout.tsx` só
 * envolve *páginas* — um Route Handler é atingido direto pelo navegador
 * (download de arquivo), sem passar pelo layout, então não herda a checagem
 * de sessão que `usuarioAtual()` já faz para toda página do painel (ver
 * comentário em `layout.tsx`). Esta função repete a checagem por conta
 * própria: `usuarioAtual()` para 401 (sem sessão OU usuário desativado — a
 * mesma mensagem "Não autenticado" para os dois casos, de propósito, ver
 * `core/auth/session.ts`), depois `hasPermission` para 403.
 *
 * `listarLeads()` (Task 16, `core/leads/queries.ts`) devolve TODO lead, para
 * qualquer papel, sem escopo por `responsavelId` — decisão de negócio já
 * tomada e documentada lá (revenda pequena, equipe colaborativa; uma
 * restrição por responsável foi tentada e revertida no fix round 1/5 porque
 * `/leads/kanban` e `moverEtapa` já não tinham nenhuma). Uma nota antiga
 * numa versão anterior deste brief pedia para esta exportação filtrar por
 * responsável — essa nota foi retratada; a exportação usa exatamente o que
 * `listarLeads()` devolve, sem filtro adicional, para não reabrir a mesma
 * inconsistência (dado "protegido" na exportação mas livre num clique de
 * distância na tabela) que motivou a reversão original.
 */
export async function GET() {
  let usuario;
  try {
    usuario = await usuarioAtual();
  } catch {
    return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
  }

  if (!hasPermission(usuario.papel, "exportar_leads")) {
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  }

  const leads = await listarLeads();

  const cabecalho = ["Contato", "Telefone", "Etapa", "Responsável", "Canal", "Criado em"];
  const linhas = leads.map((lead) =>
    linhaCsv([
      // Mesma redação de "sem dado" das outras telas de lead (page.tsx,
      // lead-table.tsx, Task 16) — um lead vindo de clique no WhatsApp pode
      // não ter contato identificado ainda (`Lead.contact` nullable, Task
      // 13); um lead pode não ter responsável atribuído.
      lead.contact?.nome ?? "Sem contato identificado",
      lead.contact?.telefone ? formatarTelefoneExibicao(lead.contact.telefone) : "—",
      lead.stage.nome,
      lead.responsavel?.nome ?? "Sem responsável",
      rotuloCanal[lead.canal],
      formatarDataHoraExibicao(lead.criadoEm),
    ])
  );

  // BOM UTF-8 primeiro: é o que faz o Excel pt-BR abrir o arquivo como
  // UTF-8 em vez de assumir Windows-1252 e transformar acento em mojibake.
  const csv = "﻿" + [linhaCsv(cabecalho), ...linhas].join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=leads.csv",
    },
  });
}
