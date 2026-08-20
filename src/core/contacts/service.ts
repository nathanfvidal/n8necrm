import { prismaDaEmpresa } from "@/core/tenancy/escopo";
import { registrarAuditoria } from "@/core/audit/log";
import { normalizarTelefone } from "@/core/leads/dedupe";
import { camposCadastraisSchema, type CamposCadastrais } from "./schema";
import type { Contact } from "@prisma/client";

/** O cliente Prisma já amarrado a uma empresa. */
type ClienteDaEmpresa = ReturnType<typeof prismaDaEmpresa>;

/**
 * Escrita da agenda de contatos, escopada por empresa (Ciclo 1a).
 *
 * ## As duas funções ganharam `companyId` como PRIMEIRO parâmetro
 *
 * `atualizarContato` validava `dados.id` só por EXISTÊNCIA — a família de
 * defeito que este ciclo já viu seis vezes. O `id` chega de
 * `atualizarContatoAction`, que é endpoint HTTP público, então qualquer id
 * conhecido reescrevia o cadastro de qualquer contato do banco, com o autor
 * registrado no `AuditLog` da empresa errada.
 *
 * O parâmetro é o PRIMEIRO e fica FORA de `dados` de propósito: `dados` é o
 * payload do formulário, que vem do cliente e é forjável. Empresa dentro dele
 * seria empresa vinda de parâmetro de formulário — a origem é
 * `usuarioAtual().companyId` na Server Action, e só ela.
 *
 * O `companyIdDoUsuario(autorId)` que `criarContato` usava saiu junto, e o
 * ganho é maior que um import a menos: ele pega um vínculo ARBITRÁRIO de quem
 * tiver mais de um (o próprio arquivo se documenta como ponte temporária por
 * isso), então um contato criado por alguém com dois vínculos podia nascer na
 * empresa errada mesmo sem existir vazamento de leitura.
 *
 * ## O que o escopo faz por este arquivo, e o que ele NÃO faz
 *
 * `prismaDaEmpresa` injeta `where.companyId`/`data.companyId` e LANÇA nas
 * operações por chave única — é por isso que `findUnique` virou `findFirst` e
 * `update` virou `updateManyAndReturn` aqui dentro. Ver "Recusa, lançando" em
 * `core/tenancy/escopo.ts`.
 *
 * ## Reaproveita `normalizarTelefone`, não escreve outro
 *
 * O normalizador mora em `core/leads/dedupe.ts` e resolve um problema com
 * história: código do país, o 9º dígito do celular, e a recusa de números
 * incompletos — porque dois contatos sem telefone colidiriam na constraint
 * UNIQUE e fundiriam o histórico de duas pessoas diferentes, o que é
 * irreversível.
 *
 * Já existe um SEGUNDO normalizador no projeto
 * (`normalizarTelefoneWhatsapp`, em `modules/whatsapp/telefone.ts`), que
 * resolve outro problema: o formato do `waId` que a Evolution manda, e que
 * NÃO lança quando não reconhece. Um terceiro aqui seria a receita para a
 * mesma pessoa virar dois contatos dependendo de por onde entrou.
 *
 * ## Não existe exclusão
 *
 * `Lead.contactId` é opcional e sem cascade: apagar um contato deixaria leads
 * órfãos em silêncio — o funil continuaria mostrando a oportunidade, sem
 * ninguém do outro lado. Corrigir um cadastro errado é editar, não apagar.
 */

/** Erro esperado e seguro de mostrar na tela — mesmo papel de `UsuarioInvalidoError`. */
export class ContatoInvalidoError extends Error {}

const MAX_NOME = 120;
const MAX_EMAIL = 254;

function validarNome(bruto: string): string {
  const nome = bruto.trim();
  if (nome.length === 0) throw new ContatoInvalidoError("O nome é obrigatório.");
  if (nome.length > MAX_NOME) {
    throw new ContatoInvalidoError(`O nome pode ter no máximo ${MAX_NOME} caracteres.`);
  }
  return nome;
}

/**
 * E-mail é opcional aqui (ao contrário de `User`): muito lead de WhatsApp
 * chega só com telefone, e exigir e-mail obrigaria a inventar um. String
 * vazia vira `null`, não `""` — senão a coluna passa a ter dois jeitos de
 * dizer "não tem", e toda consulta futura precisa lembrar dos dois.
 */
function validarEmail(bruto: string | undefined): string | null {
  const email = bruto?.trim().toLowerCase() ?? "";
  if (email.length === 0) return null;
  if (email.length > MAX_EMAIL) {
    throw new ContatoInvalidoError(`O e-mail pode ter no máximo ${MAX_EMAIL} caracteres.`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ContatoInvalidoError("E-mail inválido.");
  }
  return email;
}

/**
 * Normaliza o telefone, traduzindo a recusa de `normalizarTelefone` (que lança
 * `Error` com texto técnico, feito para log) numa mensagem de formulário.
 */
function validarTelefone(bruto: string): string {
  try {
    return normalizarTelefone(bruto);
  } catch {
    throw new ContatoInvalidoError(
      "Telefone inválido. Use DDD + número — 11 dígitos para celular, 10 para fixo."
    );
  }
}

/**
 * Monta a mensagem de colisão já com o NOME de quem ocupa o telefone —
 * **quando o dono é desta empresa**.
 *
 * "Já existe um contato com este telefone" sozinho manda a pessoa procurar às
 * cegas; com o nome, ela reconhece na hora se é a mesma pessoa (e não precisa
 * cadastrar) ou se digitou o número errado.
 *
 * ## Por que a busca é escopada, e por que a mensagem tem dois ramos
 *
 * A versão anterior fazia `findUnique({ where: { telefone } })` no prisma cru.
 * `Contact.telefone` é `@unique` GLOBAL (`prisma/schema.prisma`), então
 * digitar um número qualquer no cadastro devolvia na tela o NOME do contato de
 * outra empresa — um oráculo de "quem é o cliente do concorrente neste
 * número", alcançável por qualquer sessão e sem precisar de id nenhum.
 *
 * Escopada, a busca não acha o dono de fora, e aí o `P2002` que veio do banco
 * precisa de explicação própria: o número existe, só que fora do alcance desta
 * empresa. É o mesmo limite de schema que `encontrarOuCriarContact`
 * (`core/leads/dedupe.ts`) já trata recusando de forma explicada — a unicidade
 * global de `telefone` é irmã de `PipelineStage.@@unique([ordem])`, as duas
 * bloqueiam a segunda empresa de verdade, e nenhuma é mexida aqui: trocar
 * unicidade global por composta é item à parte, com migração. O que muda é a
 * FORMA da falha, que sem este ramo sairia como "já está cadastrado para outro
 * contato" — mensagem que manda a pessoa procurar na agenda dela por alguém
 * que não está lá.
 *
 * O nome de quem está fora do escopo não entra em nenhum dos dois ramos, e há
 * caso de teste para cada um (`tests/unit/contact-isolamento.test.ts`).
 */
async function erroDeTelefoneOcupado(
  db: ClienteDaEmpresa,
  telefone: string
): Promise<ContatoInvalidoError> {
  const dono = await db.contact.findFirst({ where: { telefone }, select: { nome: true } });
  return new ContatoInvalidoError(
    dono
      ? `Este telefone já está cadastrado para ${dono.nome}.`
      : "Este telefone já está cadastrado fora desta empresa e não pode ser reaproveitado aqui."
  );
}

function ehTelefoneDuplicado(erro: unknown): boolean {
  return typeof erro === "object" && erro !== null && "code" in erro && erro.code === "P2002";
}

/**
 * Campos do cadastro de pessoa. Todos opcionais em dois níveis, e a diferença
 * importa: **ausente** (`undefined`) significa "não mexa nesta coluna" para o
 * `update` do Prisma; **`null`** significa "apague o que está lá". O
 * formulário manda todos os campos sempre, mas a assinatura precisa distinguir
 * os dois para que uma chamada parcial futura não apague dado sem querer.
 */
export type DadosCadastrais = {
  empresa?: string | null;
  cargo?: string | null;
  documento?: string | null;
  endereco?: string | null;
  cidade?: string | null;
  uf?: string | null;
  observacoes?: string | null;
};

/**
 * `safeParse` → erro de domínio, nunca `parse` cru: um `ZodError` solto
 * carrega o caminho do campo e o valor recebido, e atravessaria até a tela.
 * Modelo copiado de `storage.ts:133-138`.
 *
 * Só a PRIMEIRA mensagem é usada — concatenar todas produziria um parágrafo
 * num alerta de formulário.
 */
function validarCadastrais(dados: DadosCadastrais): CamposCadastrais {
  const analisado = camposCadastraisSchema.safeParse(dados);
  if (!analisado.success) {
    throw new ContatoInvalidoError(analisado.error.issues[0].message);
  }
  return analisado.data;
}

/**
 * O retrato do contato que vai para o `AuditLog`.
 *
 * ## Por que existe uma função, e não um objeto escrito na mão em cada lugar
 *
 * `registrarAuditoria` recebe `antes`/`depois` montados à mão pelo chamador.
 * Com 3 campos isso era inofensivo; com 11, esquecer um produz um log que
 * *parece* completo — e log incompleto é pior que log ausente, porque quem
 * investiga confia nele. Uma função só, usada nas duas pontas, faz o campo
 * novo aparecer nos dois lados ou em nenhum.
 *
 * ## Por que `observacoes` entra como tamanho, e não como texto
 *
 * São até 4000 caracteres. Gravados em `antes` E em `depois` a cada edição,
 * viram 8000 caracteres por linha de auditoria — `AuditLog` incha rápido e
 * nenhum investigador precisa do texto para responder "quem mexeu e quando".
 * O tamanho basta para ver que mudou; o texto atual está no próprio contato.
 */
function instantaneoParaAuditoria(contato: Contact) {
  return {
    nome: contato.nome,
    telefone: contato.telefone,
    email: contato.email,
    empresa: contato.empresa,
    cargo: contato.cargo,
    // `documento` NÃO entra, nem parcial. Foi achado R1 da auditoria desta
    // branch e o dono decidiu tirar.
    //
    // A versão anterior gravava o CPF/CNPJ inteiro, com o argumento de que a
    // trilha precisa responder "qual era antes". O argumento contrário venceu
    // e é mais forte: isso duplica dado pessoal numa segunda tabela, sem prazo
    // de descarte, e `AuditLog` não tem FK para `Contact` — no dia em que
    // existir exclusão de contato, o CPF sobreviveria à pessoa que pediu para
    // ser apagada.
    //
    // O que sobra ainda responde as perguntas de investigação que importam:
    // QUEM mexeu, QUANDO, e SE o documento mudou. O valor atual está no
    // próprio contato, que é onde dado de pessoa deve morar — em um lugar só.
    documentoPreenchido: contato.documento !== null,
    endereco: contato.endereco,
    cidade: contato.cidade,
    uf: contato.uf,
    observacoesTamanho: contato.observacoes?.length ?? 0,
  };
}

export async function criarContato(
  companyId: string,
  dados: { nome: string; telefone: string; email?: string } & DadosCadastrais,
  autorId: string
): Promise<Contact> {
  const db = prismaDaEmpresa(companyId);
  const nome = validarNome(dados.nome);
  const telefone = validarTelefone(dados.telefone);
  const email = validarEmail(dados.email);
  const cadastrais = validarCadastrais(dados);

  let criado: Contact;
  try {
    // `companyId` explícito no `data` mesmo sob escopo: a extensão `$extends`
    // de query altera os ARGUMENTOS em tempo de execução e não os TIPOS, então
    // `ContactUncheckedCreateInput` continua exigindo o campo. Para uma
    // chamada que já o passa, o escopo age como VERIFICADOR — confere que bate
    // e recusa se não bater. Ver "O tipo não sabe o que o runtime faz" em
    // `core/tenancy/escopo.ts`.
    criado = await db.contact.create({ data: { companyId, nome, telefone, email, ...cadastrais } });
  } catch (erro) {
    // Deixamos o banco decidir em vez de consultar antes: entre a consulta e a
    // escrita cabe outra criação com o mesmo telefone. Mesmo raciocínio de
    // `encontrarOuCriarContact` — só que ali a corrida é resolvida devolvendo
    // o contato existente (o chamador só quer UM contato), e aqui ela é
    // relatada, porque quem está preenchendo o formulário precisa saber que a
    // pessoa já estava cadastrada.
    if (ehTelefoneDuplicado(erro)) throw await erroDeTelefoneOcupado(db, telefone);
    throw erro;
  }

  await registrarAuditoria({
    userId: autorId,
    acao: "criar_contato",
    entidade: "Contact",
    entidadeId: criado.id,
    depois: instantaneoParaAuditoria(criado),
  });

  return criado;
}

export async function atualizarContato(
  companyId: string,
  dados: { id: string; nome: string; telefone: string; email?: string } & DadosCadastrais,
  autorId: string
): Promise<Contact> {
  const db = prismaDaEmpresa(companyId);
  const nome = validarNome(dados.nome);
  const telefone = validarTelefone(dados.telefone);
  const email = validarEmail(dados.email);
  const cadastrais = validarCadastrais(dados);

  // Linha INTEIRA, sem `select`. É a exceção deliberada à regra da casa (que
  // manda projetar): o retrato de auditoria precisa de todas as colunas, e um
  // `select` escrito à mão aqui é exatamente o lugar onde alguém esqueceria de
  // acrescentar a coluna nova — produzindo um `antes` que parece completo. Não
  // atravessa fronteira nenhuma: só `instantaneoParaAuditoria` lê este objeto,
  // e `Contact` não guarda senha.
  //
  // `findFirst` e não `findUnique`: o escopo recusa `findUnique` em modelo de
  // tenant, lançando. É também esta linha que fecha o defeito ALTA deste
  // arquivo — o `id` chega da Server Action e era validado só por EXISTÊNCIA.
  // Contato de outra empresa some daqui, e a função para com a MESMA mensagem
  // que um id inexistente produz: distinguir os dois casos confirmaria o id a
  // quem estivesse varrendo.
  const antes = await db.contact.findFirst({ where: { id: dados.id } });
  if (!antes) throw new ContatoInvalidoError("Contato não encontrado.");

  let depois: Contact | undefined;
  try {
    // `updateManyAndReturn` no lugar de `update`, pelo mesmo motivo e no mesmo
    // desenho de `atualizarLeadEscopado` (`core/leads/service.ts`): o escopo
    // recusa `update` em modelo de tenant (o `where` dela só aceita campo
    // único, e `companyId` não é único em `Contact`), e esta é a equivalente
    // escopável que ainda devolve a linha gravada — que é o que a auditoria
    // precisa para montar o "depois".
    [depois] = await db.contact.updateManyAndReturn({
      where: { id: dados.id },
      data: { nome, telefone, email, ...cadastrais },
    });
  } catch (erro) {
    // Trocar o telefone para um que já é de outra pessoa colide na mesma
    // constraint UNIQUE. Sem este tratamento, corrigir um dígito errado podia
    // devolver erro cru do Prisma na tela.
    if (ehTelefoneDuplicado(erro)) throw await erroDeTelefoneOcupado(db, telefone);
    throw erro;
  }

  // Lista vazia significa que o `where` composto (`id` + `companyId` do
  // escopo) não casou com nenhuma linha. O `findFirst` acima já encontrou o
  // contato sob o MESMO escopo, então isso só acontece se a linha sumir entre
  // as duas consultas — corrida real, ainda que rara. Parar aqui é o que
  // impede o `[0]` de virar `undefined` disfarçado de `Contact` e o erro
  // aparecer três linhas adiante, sem relação visível com a causa.
  if (!depois) throw new ContatoInvalidoError("Contato não encontrado.");

  await registrarAuditoria({
    userId: autorId,
    acao: "editar_contato",
    entidade: "Contact",
    entidadeId: depois.id,
    antes: instantaneoParaAuditoria(antes),
    depois: {
      ...instantaneoParaAuditoria(depois),
      // O tamanho sozinho não distingue "não mexeu" de "trocou uma palavra por
      // outra do mesmo tamanho". Este booleano é o que fecha essa lacuna sem
      // gravar o texto — é a única coisa que a comparação de tamanhos perde.
      observacoesAlterada: antes.observacoes !== depois.observacoes,
      // Mesma ideia para o documento, e aqui ela é ainda mais necessária:
      // `documentoPreenchido` não muda quando um CPF vira outro CPF, então sem
      // este booleano a troca do documento de alguém seria invisível na
      // trilha — que é justamente o evento mais suspeito que ela deveria
      // registrar.
      documentoAlterado: antes.documento !== depois.documento,
    },
  });

  return depois;
}
