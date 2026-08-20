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
import { companyIdDoUsuario } from "@/core/users/empresa";
import { validarCamposNovosDaTarefa } from "./schema";
import type { Task } from "@prisma/client";

/**
 * Confere que o contato existe **E é da empresa da tarefa** antes de gravar o
 * vínculo. Irmã de `exigirLeadDaEmpresa` (logo abaixo) em tudo — inclusive em
 * por que ela existe.
 *
 * Sem a checagem de EXISTÊNCIA, um id que não corresponde a contato nenhum
 * faria o Prisma estourar violação de FK crua (P2003), sem mensagem acionável,
 * e a pessoa leria "Falha ao salvar a tarefa".
 *
 * Sem a checagem de EMPRESA — que é como esta função nasceu, sob o nome
 * `exigirContatoExistente` —, `Task.contactId` da empresa A podia apontar para
 * `Contact` da B. `contactId` chega de `criarMinhaTaskAction`/`editarTaskAction`
 * (`actions.ts`), que são Server Actions, e Server Action é endpoint HTTP
 * público: o id é forjável e o seletor da tela não é a fronteira. O efeito
 * visível era a lista de `/tasks` mostrando o NOME de um contato de outro
 * cliente (`listarTasksComLead`, `queries.ts`, traz o contato junto).
 *
 * Ficou aberta de propósito quando `exigirLeadDaEmpresa` foi fechada
 * (`da2a402`): o dono do projeto pediu a contagem completa dos defeitos de
 * tenancy antes de decidir quantos corrigir. A decisão veio em 2026-08-20, e a
 * cura é a mesma linha — `companyId` no `where`, com a empresa vindo das
 * mesmas duas origens já medidas para o lead (`companyIdDoUsuario(
 * responsavelId)` ao criar, `task.companyId` ao editar).
 *
 * A mensagem é a MESMA de "não existe", palavra por palavra, pelos dois
 * motivos de sempre: não confirmar a quem sonda ids que aquele cuid pertence a
 * alguém, e porque `actions.ts` a reconhece por prefixo
 * (`MENSAGENS_MELHORADAS`, `/^Contato não encontrado/`) para trocá-la por
 * "Esse contato não existe mais. Atualize a página."
 *
 * `prisma` cru com `companyId` explícito, e não o cliente escopado, pelo mesmo
 * motivo escrito em `exigirLeadDaEmpresa`: `tasks/` ainda está na exceção do
 * lint e a conversão é do próximo ciclo — dois caminhos de acesso ao banco no
 * mesmo arquivo é pior que um caminho consistente e anotado.
 */
async function exigirContatoDaEmpresa(contactId: string, companyId: string): Promise<void> {
  const contato = await prisma.contact.findFirst({
    where: { id: contactId, companyId },
    select: { id: true },
  });
  if (!contato) {
    throw new Error(`Contato não encontrado: "${contactId}" não corresponde a nenhum contato.`);
  }
}

/**
 * Confere que o lead existe **E é da empresa da tarefa** antes de gravar o
 * vínculo.
 *
 * ## O vazamento que criou esta função
 *
 * `criarTask` e `editarTask` faziam
 * `prisma.lead.findUnique({ where: { id: input.leadId } })` com um
 * `if (!lead) throw` — só EXISTÊNCIA, nunca empresa. `leadId` chega de
 * `criarMinhaTaskAction`/`editarTaskAction` (`actions.ts`), que são Server
 * Actions, e Server Action é endpoint HTTP público: o id é forjável e o
 * `<select>` da tela não é a fronteira. Uma Task da empresa A nascia (ou era
 * reapontada) para um Lead da B, e daí em diante `/leads/[id]` da B passava a
 * listar tarefa de fora (`listarTasksPendentesDoLead`, `queries.ts`) e o
 * título dela — escrito por alguém de outra empresa — aparecia na tela.
 *
 * É a QUARTA vez que esta família aparece no Ciclo 1a, sempre com a mesma
 * forma — "valida que EXISTE, nunca que é da mesma empresa":
 *
 * 1. `core/audit/alerta.ts`, destinatários do alerta de rajada (3744e64)
 * 2. `src/modules/whatsapp/notificacoes.ts`, fan-out do aviso (63cecd2)
 * 3. `core/leads/service.ts`, responsável do lead, três pontos (6dfb325)
 * 4. este arquivo
 *
 * ## Por que `where` com `companyId` à mão, e não o cliente escopado
 *
 * Porque `tasks/` ainda está na exceção do lint (`eslint.config.mjs`) e a
 * conversão para `prismaDaEmpresa` é do próximo ciclo — converter só esta
 * função deixaria o arquivo com dois caminhos de acesso ao banco, que é pior
 * que um caminho consistente e anotado. É exatamente a forma que
 * `core/audit/alerta.ts` e `src/modules/whatsapp/notificacoes.ts` já usam:
 * `prisma` cru com `companyId` explícito no `where`, vindo de uma origem sã.
 * Quando `tasks/` for convertido, isto vira `db.lead.findFirst({ where: { id } })`
 * e o filtro passa a ser injetado.
 *
 * ## De onde vem `companyId` (medido, não presumido)
 *
 * - `criarTask`: `companyIdDoUsuario(input.responsavelId)` — o MESMO valor que
 *   já era gravado em `Task.companyId` logo abaixo. Não há origem nova aqui: a
 *   chamada só subiu de lugar. `responsavelId` nunca vem do cliente, é sempre
 *   `usuarioAtual().id` (ver `criarMinhaTaskAction`).
 * - `editarTask`: `task.companyId` — a linha já está em mãos e já passou pela
 *   regra de dono (`task.responsavelId === input.autorId`), então é a origem
 *   mais precisa E a mais barata (nenhuma consulta extra). Não é "a empresa do
 *   primeiro vínculo de quem age": é a empresa da PRÓPRIA tarefa que está
 *   sendo editada, que é a invariante que interessa — `Task.leadId` só pode
 *   apontar para Lead da mesma empresa da Task.
 *
 * ## A mensagem é a MESMA de "não existe"
 *
 * De propósito, e preservada palavra por palavra. Distinguir "não existe" de
 * "existe, mas é de outra empresa" confirmaria, a quem sonda ids, que aquele
 * cuid pertence a alguém. Mesmo raciocínio de `concluirTask` (abaixo) e de
 * `responsavelDaEmpresa` (`core/leads/service.ts`). O texto importa também
 * porque `actions.ts` o reconhece por prefixo (`MENSAGENS_MELHORADAS`,
 * `/^Lead não encontrado/`) para trocá-lo por "Esse lead não existe mais.
 * Atualize a página."
 */
async function exigirLeadDaEmpresa(leadId: string, companyId: string): Promise<void> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId },
    select: { id: true },
  });
  if (!lead) {
    throw new Error(`Lead não encontrado: "${leadId}" não corresponde a nenhum lead.`);
  }
}

/**
 * Cria uma tarefa.
 *
 * `responsavelId` é explícito aqui de propósito — mesmo padrão de
 * `criarLead`/`adicionarNota` (Task 13/17): esta função é a camada testável
 * por Vitest sem precisar de sessão HTTP. Quem chama com um `responsavelId`
 * forjado é responsabilidade de quem chama — a barreira real fica em
 * `criarMinhaTaskAction` (`actions.ts`), que deriva `responsavelId` de
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
 * `leadId`, quando informado, é conferido contra `Lead` **da mesma empresa**
 * antes de gravar (ver `exigirLeadDaEmpresa` acima): sem a checagem de
 * existência, um id que não corresponde a nenhum lead faria o
 * `prisma.task.create` abaixo estourar uma violação de FK crua (P2003), sem
 * mensagem acionável — mesmo raciocínio de `moverEtapa`
 * (`leads/service.ts`) ao validar `novaStageId` antes de escrever; sem a
 * checagem de EMPRESA, a tarefa nascia pendurada no lead de outro cliente.
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

  // `Task.companyId` é `NOT NULL` desde a Task 1 do Ciclo 1a. `criarTask`,
  // ao contrário de `criarLead`/`criarEtapa`, não recebe `autorId` (tarefa é
  // lembrete pessoal, não audita a criação — ver o comentário de
  // `concluirTask` abaixo sobre essa distinção). O parâmetro disponível é
  // `responsavelId` — dono da tarefa — e é ele quem define a empresa.
  //
  // Resolvido AQUI, e não logo antes do `create` como antes: a empresa da
  // tarefa é o que dá sentido à checagem de `leadId` logo abaixo. Enquanto a
  // resolução ficava depois, não havia com o que comparar o lead, e a
  // checagem só sabia perguntar se ele existia. A única diferença observável
  // da mudança de lugar é a ORDEM das recusas — um `responsavelId` sem
  // `Membership` agora falha antes de "Descrição longa demais", e nenhum
  // caminho de produção alcança isso: `responsavelId` é sempre
  // `usuarioAtual().id`, que só existe com vínculo.
  const companyId = await companyIdDoUsuario(input.responsavelId);

  if (input.leadId) {
    await exigirLeadDaEmpresa(input.leadId, companyId);
  }

  // Apara ANTES de validar: senão um texto no limite exato reprovaria por
  // causa de um espaço no fim que não vai ser gravado.
  const { descricao, contactId } = validarCamposNovosDaTarefa({
    descricao: input.descricao?.trim(),
    contactId: input.contactId,
  });

  if (contactId) {
    // Mesma `companyId` que já foi resolvida para o `leadId` acima e que vai
    // para a coluna `Task.companyId` logo abaixo — nenhuma origem nova.
    await exigirContatoDaEmpresa(contactId, companyId);
  }

  return prisma.task.create({
    data: {
      companyId,
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
 * colega só chamando `concluirMinhaTaskAction` com um id adivinhado — não é
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
    // `task.companyId` e não a empresa de quem age: a invariante é
    // `Task.leadId` apontar para Lead da MESMA empresa da Task. A linha já
    // está em mãos e já passou pela regra de dono acima — nenhuma consulta
    // extra, e nenhuma chance de a empresa da tarefa divergir da empresa
    // usada na checagem. Ver `exigirLeadDaEmpresa` no topo do arquivo.
    await exigirLeadDaEmpresa(input.leadId, task.companyId);
  }

  const { descricao, contactId } = validarCamposNovosDaTarefa({
    descricao: input.descricao?.trim(),
    contactId: input.contactId,
  });

  if (contactId) {
    // `task.companyId`, pelo mesmo motivo do `leadId` acima: a invariante é
    // `Task.contactId` apontar para Contact da MESMA empresa da Task, e a
    // linha já está em mãos e já passou pela regra de dono.
    await exigirContatoDaEmpresa(contactId, task.companyId);
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
