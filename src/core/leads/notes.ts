import "server-only";

import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/core/audit/log";
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
 *
 * Exportado (não `const` privada do módulo): a página de detalhe
 * (`src/app/(painel)/leads/[id]/page.tsx`, um Server Component) importa
 * este valor e passa por PROP para `LeadNoteForm` (Client Component), que
 * usa no `maxLength` do `<Textarea>` — só um limite client-side de
 * conveniência, não a validação real, para que o número nunca precise
 * divergir silenciosamente entre os dois lugares depois de uma mudança
 * futura. `LeadNoteForm` NÃO importa este módulo diretamente: com
 * `import "server-only"` no topo deste arquivo (fix round 2/5, achado do
 * revisor — mesmo padrão de `src/lib/storage.ts`/`src/lib/prisma.ts`), um
 * Client Component que importar qualquer coisa daqui recebe um erro de
 * build explícito ("This module cannot be imported from a Client
 * Component..."), não a coincidência de antes (o bundler tropeçando em
 * `pg`/`dns` por acaso, que pararia de proteger nada no dia em que o driver
 * do Postgres mudasse). A validação que importa continua sendo a de baixo,
 * no servidor.
 */
export const TEXTO_MAX_LENGTH = 4000;

// Só os campos que a UI de fato renderiza (`autor.nome`, mais `id` para
// `key`/testes) — nunca a linha inteira de `User`. `senhaHash` em
// particular não tem por que existir em memória do servidor só para
// mostrar um nome; carregá-lo aqui via `include: { autor: true }` (versão
// anterior deste arquivo) não vazava para o cliente hoje, mas é o tipo de
// coisa que vaza no dia em que alguém passar este objeto um nível adiante
// para um Client Component. Fix round 1/5, achado do revisor.
export type LeadNoteComAutor = LeadNote & { autor: Pick<User, "id" | "nome"> };

/**
 * Registra uma nota em um lead.
 *
 * `autorId` é explícito aqui de propósito — mesmo padrão de `criarLead`/
 * `moverEtapa` (service.ts, Task 13): esta função é a camada testável por
 * Vitest sem precisar de sessão HTTP. Quem chama com um `autorId` forjado é
 * responsabilidade de quem chama — a barreira real fica em
 * `adicionarNotaAction` (`src/core/leads/actions.ts`), que deriva `autorId`
 * de `usuarioAtual()` e nunca aceita esse campo do cliente.
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
    include: { autor: { select: { id: true, nome: true } } },
    orderBy: { criadoEm: "desc" },
  });
}

/**
 * Regra de dono, igual a `concluirTask` (`core/tasks/service.ts`): só o autor
 * edita a própria nota.
 *
 * A mensagem é a MESMA para "não existe" e para "não é sua", de propósito.
 * Diferenciá-las confirmaria, a quem está adivinhando ids, que aquele id
 * pertence a alguém — mesmo sem revelar a quem.
 *
 * `editadoEm` existe para a tela poder marcar "editada". Sem isso o histórico
 * mente por omissão: o texto muda e nada indica que mudou.
 *
 * Auditado (ao contrário de tarefa) porque nota vive num lead — pipeline
 * compartilhado, que a equipe inteira lê. Ver a § 3 da spec.
 */
export async function editarNota(input: {
  notaId: string;
  texto: string;
  autorId: string;
}): Promise<LeadNote> {
  const nota = await prisma.leadNote.findUnique({ where: { id: input.notaId } });
  if (!nota || nota.autorId !== input.autorId) {
    throw new Error("Nota não encontrada");
  }

  const texto = input.texto.trim();
  if (!texto) {
    throw new Error("Nota vazia: informe um texto para a nota.");
  }
  if (texto.length > TEXTO_MAX_LENGTH) {
    throw new Error(
      `Nota muito longa: o texto tem ${texto.length} caracteres, o máximo permitido é ${TEXTO_MAX_LENGTH}.`
    );
  }

  const depois = await prisma.leadNote.update({
    where: { id: input.notaId },
    data: { texto, editadoEm: new Date() },
  });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "editar_nota",
    entidade: "LeadNote",
    entidadeId: nota.id,
    antes: { texto: nota.texto },
    depois: { texto },
  });

  return depois;
}

/**
 * Remoção real, não lógica: nota não é referenciada por nada, e uma nota
 * "apagada" que continuasse no banco só criaria uma segunda categoria de
 * registro invisível para manter. O texto vai para a auditoria antes de
 * sumir — é lá que fica o rastro.
 */
export async function excluirNota(input: { notaId: string; autorId: string }): Promise<void> {
  const nota = await prisma.leadNote.findUnique({ where: { id: input.notaId } });
  if (!nota || nota.autorId !== input.autorId) {
    throw new Error("Nota não encontrada");
  }

  await prisma.leadNote.delete({ where: { id: input.notaId } });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "excluir_nota",
    entidade: "LeadNote",
    entidadeId: nota.id,
    antes: { texto: nota.texto },
  });
}
