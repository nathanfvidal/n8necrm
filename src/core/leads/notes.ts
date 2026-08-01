import { prisma } from "@/lib/prisma";
import type { LeadNote, User } from "@prisma/client";

/**
 * Limite defensivo de tamanho do texto de uma nota. Nota é texto livre
 * digitado por uma pessoa durante um atendimento, não um campo de upload —
 * não existe uma regra de negócio documentada em outro lugar do produto que
 * defina um teto. O valor abaixo é generoso o bastante para qualquer nota
 * real (~4 páginas de texto corrido) e existe só para recusar cedo, com um
 * erro de domínio claro, um valor absurdo (ex.: um e-mail inteiro colado por
 * engano, ou um payload de outro sistema) antes que ele infle a linha no
 * banco e distorça o layout da lista de notas na página de detalhe.
 */
const TEXTO_MAX_LENGTH = 4000;

export type LeadNoteComAutor = LeadNote & { autor: User };

/**
 * Registra uma nota em um lead.
 *
 * `autorId` é explícito aqui de propósito — mesmo padrão de `criarLead`/
 * `moverEtapa` (service.ts, Task 13): esta função é a camada testável por
 * Vitest sem precisar de sessão HTTP. Quem chama com um `autorId` forjado é
 * responsabilidade de quem chama — a barreira real fica na Server Action da
 * página de detalhe (`src/app/(painel)/leads/[id]/page.tsx`), que deriva
 * `autorId` de `usuarioAtual()` e nunca aceita esse campo do cliente.
 *
 * `texto` é aparado (trim) antes de validar e gravar:
 * - Espaço/quebra de linha só nas pontas não é conteúdo; um texto composto
 *   só de espaços em branco (ex.: alguém aperta espaço e Enter sem digitar
 *   nada) não deveria virar uma nota "vazia" visível para o resto da
 *   equipe — rejeitamos com um erro de domínio claro em vez de gravar uma
 *   string vazia/só-espaço ou falhar silenciosamente.
 * - Quebras de linha NO MEIO do texto são preservadas (só as pontas são
 *   aparadas) — a página de detalhe renderiza com `whitespace-pre-wrap`
 *   para respeitar parágrafos que a pessoa digitou.
 */
export async function adicionarNota(input: {
  leadId: string;
  autorId: string;
  texto: string;
}): Promise<LeadNote> {
  const texto = input.texto.trim();

  if (!texto) {
    throw new Error("Nota vazia: informe um texto para a nota.");
  }
  if (texto.length > TEXTO_MAX_LENGTH) {
    throw new Error(
      `Nota muito longa: o texto tem ${texto.length} caracteres, o máximo permitido é ${TEXTO_MAX_LENGTH}.`
    );
  }

  return prisma.leadNote.create({
    data: { leadId: input.leadId, autorId: input.autorId, texto },
  });
}

/**
 * Lista as notas de um lead, mais recente primeiro, com o autor (`User`)
 * sempre incluído.
 *
 * Desvio deliberado da assinatura original do brief (`Promise<LeadNote[]>`,
 * sem relação carregada): a página de detalhe precisa mostrar "quem
 * escreveu" ao lado de cada nota (ver instrução de verificação em browser
 * do Task 17 — "confirme que a nota aparece com seu autor"). Sem a relação
 * carregada aqui, a página teria que rodar uma segunda consulta por
 * `autorId`, ou (pior) confiar em algum dado de autor vindo de fora desta
 * função. Carregar `autor` como parte do próprio `listarNotas` mantém num
 * único lugar tudo que a UI precisa para renderizar uma nota.
 */
export async function listarNotas(leadId: string): Promise<LeadNoteComAutor[]> {
  return prisma.leadNote.findMany({
    where: { leadId },
    include: { autor: true },
    orderBy: { criadoEm: "desc" },
  });
}
