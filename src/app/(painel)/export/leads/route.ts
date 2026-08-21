import { NextResponse } from "next/server";
import type { LeadChannel } from "@prisma/client";

import { usuarioAtual } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { registrarAuditoria } from "@/core/audit/log";
import { listarLeads } from "@/core/leads/queries";
import { checarLimiteExportLeads } from "@/core/rate-limit/export-leads";
import { formatarDataHoraBR } from "@/lib/date";
import { obterIpDaRequisicao } from "@/lib/ip";

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
 * 2. **Injeção de fórmula (CSV injection)**: um campo que começa — cru, ou
 *    depois de qualquer espaço em branco líder (fix round 1/5, ver
 *    comentário dentro de `escaparCampoCsv`) — com `=`, `+`, `-` ou `@`, OU
 *    que começa CRU com tab ou retorno de carro, é interpretado pelo
 *    Excel/LibreOffice como início de fórmula (ou tratado de forma especial
 *    na importação) ao abrir o arquivo — não como texto literal.
 *    `Contact.nome` (e, por composição, qualquer outro
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
  // Fix round 1/5, achado do revisor: a versão original testava só o
  // primeiro BYTE (`/^[=+\-@\t\r]/.test(valor)`), e um nome como " =1+1"
  // (um único espaço na frente) passava intacto, sem apóstrofo — bypass
  // documentado desta mitigação: o Excel ainda avalia como fórmula um valor
  // que começa com espaço(s) em branco seguidos de "=" (e afins), então a
  // defesa contra `=`/`+`/`-`/`@` precisa olhar o primeiro caractere depois
  // de qualquer espaço líder, não só a posição 0 crua.
  //
  // Tab e retorno de carro são tratados à parte, contra o VALOR CRU (sem
  // `trimStart()`) — de propósito: `trimStart()` remove tab/CR/quebra de
  // linha como "espaço em branco" pela definição do ECMAScript, então
  // aplicar a mesma técnica a esses dois casos teria o efeito CONTRÁRIO ao
  // pretendido: um campo como "\tOlá" (tab cru na frente, sem `=`/`+`/`-`/`@`
  // depois) pularia o tab durante o `trimStart()`, sobraria "Olá" — que não
  // dispara nada — e o campo sairia sem o apóstrofo que a lista da OWASP
  // pede para todo campo que começa com tab/CR, independente do que vem
  // depois. Checar os dois separadamente contra `valor.charAt(0)` mantém
  // esse caso protegido exatamente como estava antes deste fix, sem reabrir
  // o buraco que ele veio fechar.
  //
  // Em nenhum dos dois ramos `valor` é cortado — o apóstrofo (quando
  // necessário) é prefixado no valor ORIGINAL, então um nome que
  // genuinamente começa com espaço (sem `=`/`+`/`-`/`@` na sequência)
  // continua exportado com esse espaço intacto, só muda a condição que
  // decide se o apóstrofo entra na frente.
  const primeiroCaractereCru = valor.charAt(0);
  const primeiroCaractereAposEspacos = valor.trimStart().charAt(0);
  const precisaNeutralizar =
    primeiroCaractereCru === "\t" ||
    primeiroCaractereCru === "\r" ||
    /[=+\-@]/.test(primeiroCaractereAposEspacos);
  const neutralizado = precisaNeutralizar ? `'${valor}` : valor;

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
 * A ordem dos quatro portões é deliberada e está justificada em cada um deles,
 * abaixo: sessão (401) → permissão (403) → cota (429) → auditoria (500 se o
 * log não gravar). Só depois dos quatro o CSV é montado.
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
export async function GET(request: Request) {
  let usuario;
  try {
    usuario = await usuarioAtual();
  } catch {
    return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
  }

  if (!hasPermission(usuario.papel, "exportar_leads")) {
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  }

  // Cota DEPOIS da autorização e ANTES da consulta, nessa ordem exata:
  //
  // - depois, porque quem não pode exportar não deve nem consumir cota — do
  //   contrário bastaria martelar esta rota com um papel sem permissão para
  //   queimar o orçamento de quem tem (o mesmo raciocínio que faz o limite de
  //   login checar IP antes de conta, em `rate-limit/login.ts`);
  // - antes, porque uma requisição barrada não pode custar a leitura da base
  //   inteira. Limite em código de aplicação contém ESTRAGO, não custo: a
  //   requisição bloqueada ainda paga invocação e conexão de banco. Colocá-lo
  //   depois da consulta faria o controle antiabuso pagar o preço do abuso.
  if (!(await checarLimiteExportLeads(usuario.id))) {
    return NextResponse.json(
      { erro: "Muitas exportações seguidas. Tente novamente daqui a pouco." },
      { status: 429 }
    );
  }

  // Fix round 1/5 — teto de escala, registrado de propósito (achado do
  // revisor: o brief pedia para o volume de dado ser endereçado, e a
  // primeira versão desta rota não documentava nada sobre isso).
  //
  // `listarLeads()` carrega TODO lead (com os 3 joins) de uma vez na
  // memória do processo; o CSV inteiro é montado como uma única string
  // (`csv` abaixo) e devolvido como resposta bufferizada — sem paginação,
  // sem streaming. Decisão deliberada, correta NESTA escala (revenda
  // pequena, 4 leads no seed, dezenas/centenas no cliente real de Fase
  // 0-1): implementar streaming ou paginação agora seria complexidade sem
  // uso, sem nenhum sinal de que o volume atual precise disso.
  //
  // O que quebra primeiro quando o volume crescer (Fase 2, formulário
  // público alimentando lead em volume): NÃO é memória — alguns milhares de
  // leads como string CSV ainda cabe folgado num processo Node comum. O que
  // quebra primeiro é o LIMITE DE TEMPO DE EXECUÇÃO de uma function
  // serverless (Vercel etc.): esta rota faz uma query, monta a string
  // inteira e só então começa a enviar bytes — para um volume grande o
  // bastante, montar a resposta inteira antes do primeiro byte sair pode
  // estourar esse limite antes de qualquer dado chegar ao navegador, mesmo
  // que o processo tivesse memória de sobra.
  //
  // Quando esse teto for atingido de verdade (sintoma: exportação que timeout
  // ou nunca inicia o download em produção, não em dev), a correção não é
  // "adicionar cache" — é trocar para uma `ReadableStream` que gera e envia
  // cada linha conforme lê do banco (ou pagina a query em lotes), para o
  // primeiro byte sair antes da última linha existir. Não fazer isso agora,
  // sem sinal real do volume que vai bater esse teto, é a escolha
  // deliberada — não uma omissão.
  // `semTeto: true` — a única chamada do sistema que pede a listagem sem
  // limite, e de propósito: um CSV com 1000 de 1500 leads é indistinguível de
  // um CSV completo para quem abre a planilha, e viraria decisão de negócio
  // tomada sobre dado faltando. O teto de escala desta rota é o descrito
  // acima (tempo de execução da função), não o número de linhas.
  const { itens: leads } = await listarLeads(usuario.companyId, { semTeto: true });

  // Registro da extração em massa (Fase 2 da auditoria de segurança).
  //
  // Esta é a única rota do sistema desenhada para tirar a base inteira de
  // clientes — nome e telefone de todo lead — num arquivo só, e até aqui ela
  // não deixava rastro. `hasPermission` acima responde QUEM pode; nada
  // respondia O QUE saiu. Uma sessão de gestor roubada, ou alguém de saída da
  // empresa, levava a base completa sem produzir uma linha para investigar
  // depois. Dado pessoal saindo em bloco é justamente o evento que mais
  // importa conseguir reconstituir.
  //
  // `entidadeId: "todos"` é sentinela deliberada: a ação não incide sobre uma
  // linha, e um cuid falso ali faria a exportação aparecer no histórico de um
  // lead que ela não tocou. `depois` guarda QUANTOS registros saíram — não há
  // estado "antes"/"depois" numa leitura, e o tamanho do que atravessou a
  // porta é o que um investigador precisa saber.
  //
  // Fail-closed de propósito: se o log não grava, o CSV não sai (o `catch`
  // abaixo). Servir mesmo assim reabriria exatamente o buraco que este
  // controle veio fechar; e se a gravação falha, o banco de onde os leads
  // acabaram de ser lidos já está em apuros. O log é gravado ANTES do envio,
  // então uma resposta que se perca na rede deixa um registro de exportação
  // que não chegou — erra para o lado de registrar demais, que é o lado certo
  // para um log de auditoria.
  try {
    await registrarAuditoria({
      companyId: usuario.companyId,
      userId: usuario.id,
      acao: "exportar_leads",
      entidade: "Lead",
      entidadeId: "todos",
      depois: { totalLeads: leads.length },
      ip: obterIpDaRequisicao(request),
    });
  } catch {
    return NextResponse.json(
      { erro: "Não foi possível concluir a exportação." },
      { status: 500 }
    );
  }

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
      formatarDataHoraBR(lead.criadoEm),
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
