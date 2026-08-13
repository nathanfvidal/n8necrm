import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/core/audit/log";
import { normalizarTelefone } from "@/core/leads/dedupe";
import { camposCadastraisSchema, type CamposCadastrais } from "./schema";
import type { Contact } from "@prisma/client";

/**
 * Escrita da agenda de contatos.
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
 * Monta a mensagem de colisão já com o NOME de quem ocupa o telefone.
 *
 * "Já existe um contato com este telefone" sozinho manda a pessoa procurar às
 * cegas; com o nome, ela reconhece na hora se é a mesma pessoa (e não precisa
 * cadastrar) ou se digitou o número errado.
 */
async function erroDeTelefoneOcupado(telefone: string): Promise<ContatoInvalidoError> {
  const dono = await prisma.contact.findUnique({ where: { telefone }, select: { nome: true } });
  return new ContatoInvalidoError(
    dono
      ? `Este telefone já está cadastrado para ${dono.nome}.`
      : "Este telefone já está cadastrado para outro contato."
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
    // `documento` vai INTEIRO. É dado pessoal, e a decisão é deliberada: a
    // pergunta que esta trilha existe para responder é "quem trocou o CPF
    // desta pessoa, e qual era antes", e sem o valor ela não responde. Fica
    // registrado para a auditoria de segurança avaliar — `AuditLog` tem RLS
    // ligada e zero grants públicos, então o dado não sai daqui pela API.
    documento: contato.documento,
    endereco: contato.endereco,
    cidade: contato.cidade,
    uf: contato.uf,
    observacoesTamanho: contato.observacoes?.length ?? 0,
  };
}

export async function criarContato(
  dados: { nome: string; telefone: string; email?: string } & DadosCadastrais,
  autorId: string
): Promise<Contact> {
  const nome = validarNome(dados.nome);
  const telefone = validarTelefone(dados.telefone);
  const email = validarEmail(dados.email);
  const cadastrais = validarCadastrais(dados);

  let criado: Contact;
  try {
    criado = await prisma.contact.create({ data: { nome, telefone, email, ...cadastrais } });
  } catch (erro) {
    // Deixamos o banco decidir em vez de consultar antes: entre a consulta e a
    // escrita cabe outra criação com o mesmo telefone. Mesmo raciocínio de
    // `encontrarOuCriarContact` — só que ali a corrida é resolvida devolvendo
    // o contato existente (o chamador só quer UM contato), e aqui ela é
    // relatada, porque quem está preenchendo o formulário precisa saber que a
    // pessoa já estava cadastrada.
    if (ehTelefoneDuplicado(erro)) throw await erroDeTelefoneOcupado(telefone);
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
  dados: { id: string; nome: string; telefone: string; email?: string } & DadosCadastrais,
  autorId: string
): Promise<Contact> {
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
  const antes = await prisma.contact.findUnique({ where: { id: dados.id } });
  if (!antes) throw new ContatoInvalidoError("Contato não encontrado.");

  let depois: Contact;
  try {
    depois = await prisma.contact.update({
      where: { id: dados.id },
      data: { nome, telefone, email, ...cadastrais },
    });
  } catch (erro) {
    // Trocar o telefone para um que já é de outra pessoa colide na mesma
    // constraint UNIQUE. Sem este tratamento, corrigir um dígito errado podia
    // devolver erro cru do Prisma na tela.
    if (ehTelefoneDuplicado(erro)) throw await erroDeTelefoneOcupado(telefone);
    throw erro;
  }

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
    },
  });

  return depois;
}
