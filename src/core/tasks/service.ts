// `import "server-only"` (mesmo padrão de `src/lib/prisma.ts` e
// `src/core/leads/notes.ts`, Task 17 fix round 2/5): este módulo importa
// Prisma diretamente e concentra a lógica de autorização de dono (ver
// `concluirTask` abaixo) — exatamente o tipo de arquivo que NÃO pode acabar
// num bundle de Client Component por acidente. Sem esta linha, o único
// motivo pelo qual isso não aconteceria seria coincidência (o bundler
// tropeçando em módulos do Node que `pg` puxa por baixo), não uma garantia.
import "server-only";

import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/core/audit/log";
import { validarCamposNovosDaTarefa } from "./schema";
import type { Task } from "@prisma/client";

/**
 * Confere que o contato existe antes de gravar — mesmo raciocínio da checagem
 * de `leadId` logo abaixo: sem isto, um id que não corresponde a contato
 * nenhum faria o Prisma estourar violação de FK crua (P2003), sem mensagem
 * acionável, e a pessoa leria "Falha ao salvar a tarefa".
 */
async function exigirContatoExistente(contactId: string): Promise<void> {
  const contato = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contato) {
    throw new Error(`Contato não encontrado: "${contactId}" não corresponde a nenhum contato.`);
  }
}

/**
 * Cria uma tarefa.
 *
 * `responsavelId` é explícito aqui de propósito — mesmo padrão de
 * `criarLead`/`adicionarNota` (Task 13/17): esta função é a camada testável
 * por Vitest sem precisar de sessão HTTP. Quem chama com um `responsavelId`
 * forjado é responsabilidade de quem chama — a barreira real fica em
 * `criarMinhaTask` (`actions.ts`), que deriva `responsavelId` de
 * `usuarioAtual()` e nunca aceita esse campo do cliente.
 *
 * `titulo` é aparado e validado (mesma disciplina de `adicionarNota` para
 * `texto`, `leads/notes.ts`) — um título vazio/só-espaço não é um lembrete
 * útil, e sem essa checagem viraria uma linha vazia e confusa na lista de
 * tarefas.
 *
 * `vencimento` é conferido como uma data real (não `NaN`) mesmo já vindo
 * como `Date` do chamador: a validação de FORMATO (string "AAAA-MM-DD" do
 * `<input type="date">` → `Date`) mora em `parseDataCivil`
 * (`src/lib/date.ts`), do lado do formulário — a checagem aqui é a última
 * linha de defesa contra um `Date` inválido chegando por qualquer outro
 * caminho (um teste, uma chamada direta fora do formulário).
 *
 * `leadId`, quando informado, é conferido contra `Lead` antes de gravar:
 * sem isso, um id que não corresponde a nenhum lead faria o
 * `prisma.task.create` abaixo estourar uma violação de FK crua (P2003), sem
 * mensagem acionável — mesmo raciocínio de `moverEtapa`
 * (`leads/service.ts`) ao validar `novaStageId` antes de escrever.
 */
export async function criarTask(input: {
  titulo: string;
  descricao?: string;
  vencimento: Date;
  responsavelId: string;
  leadId?: string;
  contactId?: string | null;
}): Promise<Task> {
  const titulo = input.titulo.trim();
  if (!titulo) {
    throw new Error("Título obrigatório: informe um título para a tarefa.");
  }

  if (Number.isNaN(input.vencimento.getTime())) {
    throw new Error("Vencimento inválido: informe uma data válida.");
  }

  if (input.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: input.leadId } });
    if (!lead) {
      throw new Error(`Lead não encontrado: "${input.leadId}" não corresponde a nenhum lead.`);
    }
  }

  // Apara ANTES de validar: senão um texto no limite exato reprovaria por
  // causa de um espaço no fim que não vai ser gravado.
  const { descricao, contactId } = validarCamposNovosDaTarefa({
    descricao: input.descricao?.trim(),
    contactId: input.contactId,
  });

  if (contactId) {
    await exigirContatoExistente(contactId);
  }

  return prisma.task.create({
    data: {
      titulo,
      descricao: descricao || undefined,
      vencimento: input.vencimento,
      responsavelId: input.responsavelId,
      leadId: input.leadId,
      // Ao CRIAR, `null` e `undefined` significam a mesma coisa ("sem
      // contato") — diferente de `editarTask`, onde `null` é uma ordem de
      // desvincular. Normaliza para não gravar `null` explícito à toa.
      contactId: contactId || undefined,
    },
  });
}

/**
 * Marca uma tarefa como concluída.
 *
 * Confere que `autorId` é o dono da tarefa (`task.responsavelId`) ANTES de
 * concluir — decisão de segurança deliberadamente DIFERENTE da de leads
 * (`moverEtapa`, `leads/service.ts`, que nunca checa dono: revenda pequena,
 * equipe colaborativa, qualquer vendedor pode mover o lead de qualquer
 * colega — decisão de negócio documentada em `leads/queries.ts`/
 * `leads/page.tsx`). Tarefa não é pipeline compartilhado: é lembrete
 * pessoal ("ligar pro fornecedor às 15h"), e a Fase 1 não tem atribuição de
 * tarefa a outra pessoa (ver comentário em `actions.ts`). Sem esta
 * checagem, qualquer usuário autenticado encerraria a tarefa de qualquer
 * colega só chamando `concluirMinhaTask` com um id adivinhado — não é
 * hipotético: nada em `Task.id` (`cuid()`) impede alguém com uma conta
 * legítima de tentar ids vizinhos aos que já viu na própria lista.
 *
 * NÃO "harmonizar" esta checagem com `moverEtapa` no futuro: as duas
 * funções parecem simétricas (ambas trocam um campo de estado de uma
 * entidade), mas protegem coisas de natureza diferente — pipeline
 * compartilhado vs. lembrete pessoal — por decisão de produto, não por
 * descuido.
 *
 * A mensagem de erro é a MESMA ("Tarefa não encontrada") tanto para "id não
 * existe" quanto para "existe mas não é minha" — de propósito, não uma
 * mensagem com forma diferente para cada caso: diferenciá-las confirmaria,
 * a quem está adivinhando ids, que aquele id específico pertence a
 * alguém — mesmo sem revelar a quem.
 */
export async function concluirTask(input: { taskId: string; autorId: string }): Promise<Task> {
  const task = await prisma.task.findUnique({ where: { id: input.taskId } });
  if (!task || task.responsavelId !== input.autorId) {
    throw new Error("Tarefa não encontrada");
  }

  return prisma.task.update({
    where: { id: input.taskId },
    data: { concluidaEm: new Date() },
  });
}

/**
 * Corrige uma tarefa. Regra de dono idêntica a `concluirTask` (acima) —
 * inclusive a mensagem única para "não existe" e "não é sua".
 *
 * NÃO audita, de propósito: `criarTask` e `concluirTask` também não, porque
 * tarefa é lembrete pessoal e não pipeline compartilhado. Ver a § 3 da spec
 * e o aviso longo em `concluirTask` sobre não harmonizar as duas naturezas.
 *
 * `leadId` aceita `null` explicitamente para desvincular — `undefined` (campo
 * ausente, "não mexa no vínculo") e `null` ("tire o vínculo") significam
 * coisas diferentes aqui.
 */
export async function editarTask(input: {
  taskId: string;
  titulo: string;
  descricao?: string;
  vencimento: Date;
  leadId?: string | null;
  contactId?: string | null;
  autorId: string;
}): Promise<Task> {
  const task = await prisma.task.findUnique({ where: { id: input.taskId } });
  if (!task || task.responsavelId !== input.autorId) {
    throw new Error("Tarefa não encontrada");
  }

  const titulo = input.titulo.trim();
  if (!titulo) {
    throw new Error("Título obrigatório: informe um título para a tarefa.");
  }
  if (Number.isNaN(input.vencimento.getTime())) {
    throw new Error("Vencimento inválido: informe uma data válida.");
  }
  if (input.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: input.leadId } });
    if (!lead) {
      throw new Error(`Lead não encontrado: "${input.leadId}" não corresponde a nenhum lead.`);
    }
  }

  const { descricao, contactId } = validarCamposNovosDaTarefa({
    descricao: input.descricao?.trim(),
    contactId: input.contactId,
  });

  if (contactId) {
    await exigirContatoExistente(contactId);
  }

  return prisma.task.update({
    where: { id: input.taskId },
    data: {
      titulo,
      // `null` e não `undefined`: apagar a descrição precisa GRAVAR a
      // ausência. `undefined` faria o Prisma omitir o campo do UPDATE e a
      // descrição antiga sobreviveria à edição que a removeu.
      descricao: descricao || null,
      vencimento: input.vencimento,
      ...(input.leadId === undefined ? {} : { leadId: input.leadId }),
      // Mesma distinção do `leadId`, e vale repetir porque errar aqui é
      // silencioso: campo AUSENTE quer dizer "não mexa no vínculo",
      // `null` quer dizer "tire o vínculo". Colapsar os dois faria toda
      // edição de título apagar o contato da tarefa sem ninguém pedir.
      ...(input.contactId === undefined ? {} : { contactId: input.contactId }),
    },
  });
}

/**
 * Desfaz a conclusão. Regra de dono idêntica a `concluirTask` — inclusive a
 * mensagem única para "não existe" e "não é sua".
 *
 * NÃO audita, e isto é uma restrição, não um esquecimento: `excluirTask` é a
 * ÚNICA operação de tarefa que registra auditoria, porque é a única que
 * destrói a linha para sempre. Reabrir é reversível por definição — um
 * clique em "Concluir" desfaz. Auditar aqui encheria `AuditLog` de ruído e
 * afogaria justamente o registro que existe para investigar sabotagem.
 * `tests/unit/tasks-editar.test.ts` trava essa regra para edição; o teste
 * de reabrir faz o mesmo.
 *
 * Idempotente de propósito: reabrir uma tarefa que já está pendente grava
 * `concluidaEm: null` de novo e devolve sucesso, em vez de erro. Duas abas
 * abertas, dois cliques — o segundo não pode virar mensagem de falha para uma
 * ação cujo efeito desejado já está no lugar.
 */
export async function reabrirTask(input: { taskId: string; autorId: string }): Promise<Task> {
  const task = await prisma.task.findUnique({ where: { id: input.taskId } });
  if (!task || task.responsavelId !== input.autorId) {
    throw new Error("Tarefa não encontrada");
  }

  return prisma.task.update({
    where: { id: input.taskId },
    data: { concluidaEm: null },
  });
}

/**
 * Remoção real. `Task` não é referenciada por nenhum modelo, então não há
 * histórico a preservar na própria tabela — e uma tarefa "apagada" que
 * continuasse no banco viraria lixo invisível de manter.
 *
 * **Audita, ao contrário de `criarTask`, `concluirTask` e `editarTask`.**
 * Exceção deliberada à regra "tarefa é lembrete pessoal, auditar é ruído",
 * decidida pelo dono do projeto na auditoria de segurança desta branch:
 * excluir é a ÚNICA operação de tarefa que destrói a linha para sempre. Sem
 * este registro, alguém que queira sabotar a empresa apaga os lembretes da
 * equipe e não sobra nada que mostre o que existia nem quem apagou. O
 * `antes` guarda o conteúdo destruído — é o único lugar onde ele passa a
 * existir depois do DELETE.
 *
 * A auditoria vem DEPOIS do delete, de propósito: se o DELETE falhar, não
 * fica registro de uma exclusão que não aconteceu.
 */
export async function excluirTask(input: { taskId: string; autorId: string }): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: input.taskId } });
  if (!task || task.responsavelId !== input.autorId) {
    throw new Error("Tarefa não encontrada");
  }

  await prisma.task.delete({ where: { id: input.taskId } });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "excluir_task",
    entidade: "Task",
    entidadeId: task.id,
    antes: {
      titulo: task.titulo,
      descricao: task.descricao,
      vencimento: task.vencimento,
      leadId: task.leadId,
      concluidaEm: task.concluidaEm,
    },
  });
}

/**
 * Lista tarefas pendentes (`concluidaEm: null`), ordenadas por vencimento
 * (a mais urgente primeiro). `responsavelId` opcional: sem ele, lista TODA
 * tarefa pendente de TODO usuário — uso interno/utilitário (ex.: um script
 * administrativo futuro), nunca exposto direto numa Server Action. A UI
 * (`/tasks`, `/leads/[id]`) sempre consome `listarTasksComLead`/
 * `listarTasksPendentesDoLade` (`queries.ts`), que são sempre escopadas ao
 * usuário da sessão — mesmo raciocínio de dono de `concluirTask` acima.
 */
export async function listarTasksPendentes(responsavelId?: string): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      concluidaEm: null,
      ...(responsavelId ? { responsavelId } : {}),
    },
    orderBy: { vencimento: "asc" },
  });
}
