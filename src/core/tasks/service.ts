// `import "server-only"` (mesmo padrão de `src/lib/prisma.ts` e
// `src/core/leads/notes.ts`, Task 17 fix round 2/5): este módulo importa
// Prisma diretamente e concentra a lógica de autorização de dono (ver
// `concluirTask` abaixo) — exatamente o tipo de arquivo que NÃO pode acabar
// num bundle de Client Component por acidente. Sem esta linha, o único
// motivo pelo qual isso não aconteceria seria coincidência (o bundler
// tropeçando em módulos do Node que `pg` puxa por baixo), não uma garantia.
import "server-only";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";
import { registrarAuditoria } from "@/core/audit/log";
import { validarCamposNovosDaTarefa } from "./schema";
import type { Prisma, Task } from "@prisma/client";

/** O cliente já amarrado a uma empresa — o único caminho deste módulo ao banco. */
type ClienteDaEmpresa = ReturnType<typeof prismaDaEmpresa>;

/**
 * Carrega a tarefa DENTRO da empresa e aplica a regra de dono, num lugar só.
 *
 * As quatro funções de escrita por id (`concluir`, `editar`, `reabrir`,
 * `excluir`) abriam com as mesmas três linhas — `findUnique` por id, `if (!task
 * || task.responsavelId !== autorId) throw` — e a repetição era o risco: bastava
 * uma quinta função futura copiar duas das três. Agora são duas travas
 * INDEPENDENTES num ponto só:
 *
 * - o ESCOPO recusa tarefa de outra empresa (o `companyId` entra pelo cliente,
 *   ninguém o escreve);
 * - a regra de DONO recusa tarefa de outra pessoa.
 *
 * A segunda escondia a falta da primeira no caso comum, porque quase toda
 * tarefa de outra empresa também é de outra pessoa. O caso que as separa —
 * tarefa da empresa B cujo dono tem vínculo TAMBÉM na A — está em
 * `tests/unit/task-isolamento.test.ts`, fabricado de propósito.
 *
 * `findFirst` e não `findUnique`: o escopo recusa `findUnique` em modelo de
 * tenant (ver "Recusa, lançando" em `core/tenancy/escopo.ts`).
 *
 * A mensagem é a MESMA para os três desfechos — não existe, não é sua, não é
 * desta empresa — pelo motivo de sempre: distinguir confirmaria, a quem sonda
 * ids, que aquele cuid pertence a alguém.
 */
async function tarefaMinhaNestaEmpresa(
  db: ClienteDaEmpresa,
  taskId: string,
  autorId: string
): Promise<Task> {
  const task = await db.task.findFirst({ where: { id: taskId } });
  if (!task || task.responsavelId !== autorId) {
    throw new Error("Tarefa não encontrada");
  }
  return task;
}

/**
 * Grava numa tarefa que a checagem acima já validou, e devolve a linha nova.
 *
 * `updateManyAndReturn` e não `update`: o escopo recusa `update` em modelo de
 * tenant, porque o `where` dela só aceita campo único e não há onde pendurar o
 * `companyId` (ver "Recusa, lançando" em `core/tenancy/escopo.ts`). Mesmo
 * padrão de `atualizarLeadEscopado` (`core/leads/service.ts`) e
 * `atualizarEtapaEscopada` (`core/pipeline/service.ts`).
 *
 * O `if (!depois)` não é zelo: `updateManyAndReturn` devolve lista vazia quando
 * nada casa, em vez de lançar como `update` fazia. Sem ele, uma tarefa apagada
 * entre a leitura e a escrita viraria `undefined` devolvido como `Task` — o
 * erro apareceria três camadas adiante, sem dizer o que aconteceu.
 */
async function gravarNaTarefa(
  db: ClienteDaEmpresa,
  taskId: string,
  data: Prisma.TaskUncheckedUpdateManyInput
): Promise<Task> {
  const [depois] = await db.task.updateManyAndReturn({ where: { id: taskId }, data });

  if (!depois) {
    throw new Error(
      `Tarefa não encontrada ao gravar: "${taskId}" não está mais no escopo desta empresa.`
    );
  }

  return depois;
}

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
 * O `companyId` explícito no `where` sumiu no Ciclo 1d, e a garantia NÃO sumiu
 * com ele: quem o injeta agora é `prismaDaEmpresa`. A diferença é quem responde
 * por ela — antes, quem escrevesse a linha lembrar; hoje, o cliente. Foi
 * justamente esquecer de escrevê-la que abriu este defeito e os cinco irmãos.
 */
async function exigirContatoDaEmpresa(db: ClienteDaEmpresa, contactId: string): Promise<void> {
  const contato = await db.contact.findFirst({
    where: { id: contactId },
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
async function exigirLeadDaEmpresa(db: ClienteDaEmpresa, leadId: string): Promise<void> {
  const lead = await db.lead.findFirst({
    where: { id: leadId },
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
  companyId: string;
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

  // `Task.companyId` é `NOT NULL` desde a Task 1 do Ciclo 1a, e desde o Ciclo
  // 1d a empresa CHEGA por parâmetro em vez de ser deduzida aqui dentro.
  //
  // A dedução era `companyIdDoUsuario(input.responsavelId)`, um
  // `findFirstOrThrow` sobre `Membership` que pega um vínculo ARBITRÁRIO de
  // quem tem mais de um. `criarMinhaTaskAction` (`actions.ts`) já tem a
  // resposta certa e sem ambiguidade — `usuarioAtual().companyId`, a empresa da
  // SESSÃO —, e passá-la troca uma consulta extra por conhecimento que já
  // existia. É a mesma correção que `leads`, `pipeline`, `contacts` e
  // `whatsapp` já receberam neste ciclo.
  const db = prismaDaEmpresa(input.companyId);

  if (input.leadId) {
    await exigirLeadDaEmpresa(db, input.leadId);
  }

  // Apara ANTES de validar: senão um texto no limite exato reprovaria por
  // causa de um espaço no fim que não vai ser gravado.
  const { descricao, contactId } = validarCamposNovosDaTarefa({
    descricao: input.descricao?.trim(),
    contactId: input.contactId,
  });

  if (contactId) {
    // Mesmo cliente escopado que já conferiu o `leadId` acima — nenhuma origem
    // nova de empresa, e nenhuma chance de as duas checagens divergirem.
    await exigirContatoDaEmpresa(db, contactId);
  }

  return db.task.create({
    data: {
      companyId: input.companyId,
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
export async function concluirTask(input: {
  companyId: string;
  taskId: string;
  autorId: string;
}): Promise<Task> {
  const db = prismaDaEmpresa(input.companyId);
  await tarefaMinhaNestaEmpresa(db, input.taskId, input.autorId);

  return gravarNaTarefa(db, input.taskId, { concluidaEm: new Date() });
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
  companyId: string;
  taskId: string;
  titulo: string;
  descricao?: string;
  vencimento: Date;
  leadId?: string | null;
  contactId?: string | null;
  autorId: string;
}): Promise<Task> {
  const db = prismaDaEmpresa(input.companyId);
  await tarefaMinhaNestaEmpresa(db, input.taskId, input.autorId);

  const titulo = input.titulo.trim();
  if (!titulo) {
    throw new Error("Título obrigatório: informe um título para a tarefa.");
  }
  if (Number.isNaN(input.vencimento.getTime())) {
    throw new Error("Vencimento inválido: informe uma data válida.");
  }
  if (input.leadId) {
    // A invariante continua sendo "`Task.leadId` aponta para Lead da MESMA
    // empresa da Task", e ela continua garantida — por outro caminho. Antes era
    // `task.companyId`, lido da linha; agora é o cliente escopado, e a tarefa só
    // chegou até aqui porque ESTÁ nessa empresa (`tarefaMinhaNestaEmpresa`
    // acima recusaria qualquer outra). As duas checagens não têm mais como
    // divergir, porque não há mais duas origens.
    await exigirLeadDaEmpresa(db, input.leadId);
  }

  const { descricao, contactId } = validarCamposNovosDaTarefa({
    descricao: input.descricao?.trim(),
    contactId: input.contactId,
  });

  if (contactId) {
    // Mesmo raciocínio do `leadId` acima.
    await exigirContatoDaEmpresa(db, contactId);
  }

  return gravarNaTarefa(db, input.taskId, {
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
export async function reabrirTask(input: {
  companyId: string;
  taskId: string;
  autorId: string;
}): Promise<Task> {
  const db = prismaDaEmpresa(input.companyId);
  await tarefaMinhaNestaEmpresa(db, input.taskId, input.autorId);

  return gravarNaTarefa(db, input.taskId, { concluidaEm: null });
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
export async function excluirTask(input: {
  companyId: string;
  taskId: string;
  autorId: string;
}): Promise<void> {
  const db = prismaDaEmpresa(input.companyId);
  const task = await tarefaMinhaNestaEmpresa(db, input.taskId, input.autorId);

  // `deleteMany` e não `delete`: o escopo recusa `delete` em modelo de tenant,
  // e a recusa é o ponto — o `where` de `delete` só aceita campo único, então
  // o id sozinho alcançaria a linha de qualquer empresa.
  await db.task.deleteMany({ where: { id: input.taskId } });

  await registrarAuditoria({
    // A empresa da TAREFA, lida da linha já carregada — não o vínculo do autor.
    // Ver `ParamsDeAuditoria.companyId` em `core/audit/log.ts`.
    companyId: task.companyId,
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
export async function listarTasksPendentes(
  companyId: string,
  responsavelId?: string
): Promise<Task[]> {
  return prismaDaEmpresa(companyId).task.findMany({
    where: {
      concluidaEm: null,
      ...(responsavelId ? { responsavelId } : {}),
    },
    orderBy: { vencimento: "asc" },
  });
}
