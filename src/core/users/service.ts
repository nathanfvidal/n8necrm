import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/core/audit/log";
import { ehContaDeSistema, idsDeSistema } from "./sistema";
import type { UsuarioListado } from "./queries";
import type { Role } from "@prisma/client";

/**
 * Gestão da equipe: criar pessoa, editar nome e papel, ativar/desativar e
 * redefinir senha.
 *
 * ## Por que não existe exclusão
 *
 * `AuditLog.userId`, `LeadNote.autorId` e `Task.responsavelId` referenciam
 * `User`. Apagar uma pessoa levaria junto o rastro do que ela fez — que é
 * exatamente o que o audit log existe para preservar. Desativar já revoga o
 * acesso de verdade (ver abaixo), então "excluir" não resolveria nada que
 * "desativar" não resolva, e destruiria histórico.
 *
 * ## Desativar revoga a sessão, e isso não é código deste arquivo
 *
 * `usuarioAtual()` (`core/auth/session.ts`) consulta `User.ativo` a **cada**
 * chamada, não só no login — a sessão é JWT, sem store no servidor, então um
 * cookie já emitido continuaria válido se a checagem fosse só na entrada.
 * Este serviço só grava a coluna; quem faz a revogação valer é aquele helper.
 * O teste que prova isso ponta a ponta é o que impede alguém "otimizar" a
 * consulta de lá e transformar desativação em teatro.
 */

/**
 * Erro esperado e **seguro de mostrar** a quem está usando a tela: entrada
 * inválida, e-mail em uso, tentativa de se trancar para fora. Distinto de
 * qualquer outra falha (banco fora do ar, etc.), cujo texto nunca deve chegar
 * ao cliente — mesmo raciocínio de `RespostaHumanaInvalidaError` e
 * `ErroConfigAgente` no módulo de WhatsApp.
 */
export class UsuarioInvalidoError extends Error {}

const MAX_NOME = 120;
// 254 é o limite de um endereço de e-mail inteiro na RFC 5321.
const MAX_EMAIL = 254;
const MIN_SENHA = 8;
/**
 * O algoritmo bcrypt usa no máximo **72 bytes** da senha e descarta o resto,
 * em silêncio. Sem este teto, uma senha de 100 caracteres e os seus 72
 * primeiros caracteres autenticariam a mesma conta, e ninguém saberia — o
 * usuário acharia que tem uma senha longa. Rejeitar é honesto; truncar não.
 *
 * Medido em BYTES, não em caracteres: acentos e emoji ocupam mais de um byte
 * em UTF-8, e é o byte que o bcrypt conta.
 */
const MAX_SENHA_BYTES = 72;

/**
 * Custo do bcrypt. **Tem que continuar 10**, igual ao do seed
 * (`prisma/seed.ts`) e ao do hash inerte de `core/auth/credenciais.ts`.
 *
 * Aquele hash inerte existe para que "e-mail não existe" e "senha errada"
 * levem o mesmo tempo — a defesa contra enumeração de usuário por
 * cronometragem. A defesa depende de os hashes REAIS terem o mesmo custo do
 * inerte: usuários criados aqui com custo diferente voltariam a ser
 * distinguíveis pelo tempo de resposta do login.
 */
const CUSTO_BCRYPT = 10;

const PAPEIS: readonly Role[] = ["ADMIN", "GESTOR", "VENDEDOR"];

export type DadosNovoUsuario = {
  nome: string;
  email: string;
  papel: Role;
  senha: string;
};

function validarNome(bruto: string): string {
  const nome = bruto.trim();
  if (nome.length === 0) throw new UsuarioInvalidoError("O nome é obrigatório.");
  if (nome.length > MAX_NOME) {
    throw new UsuarioInvalidoError(`O nome pode ter no máximo ${MAX_NOME} caracteres.`);
  }
  return nome;
}

/**
 * Normaliza para minúsculas antes de gravar. `User.email` é `@unique` no
 * banco, e a unicidade do Postgres é sensível a maiúsculas — sem normalizar,
 * `Ana@empresa.com` e `ana@empresa.com` seriam duas contas distintas, e o
 * login (que busca por igualdade exata) daria "não existe" para quem digitou
 * com a caixa diferente da que cadastrou.
 *
 * A validação de formato é deliberadamente frouxa (tem um `@`, tem ponto
 * depois dele, não tem espaço): a única prova real de que um e-mail existe é
 * mandar mensagem para ele, e uma expressão regular estrita rejeita endereços
 * válidos e incomuns com mais frequência do que pega erro de digitação.
 */
function validarEmail(bruto: string): string {
  const email = bruto.trim().toLowerCase();
  if (email.length === 0) throw new UsuarioInvalidoError("O e-mail é obrigatório.");
  if (email.length > MAX_EMAIL) {
    throw new UsuarioInvalidoError(`O e-mail pode ter no máximo ${MAX_EMAIL} caracteres.`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new UsuarioInvalidoError("E-mail inválido.");
  }
  return email;
}

function validarSenha(senha: string): string {
  if (senha.length < MIN_SENHA) {
    throw new UsuarioInvalidoError(`A senha precisa de pelo menos ${MIN_SENHA} caracteres.`);
  }
  if (Buffer.byteLength(senha, "utf8") > MAX_SENHA_BYTES) {
    throw new UsuarioInvalidoError(
      `A senha é longa demais (o limite é ${MAX_SENHA_BYTES} bytes). ` +
        `Acima disso o bcrypt descartaria o excedente sem avisar.`
    );
  }
  return senha;
}

/**
 * Papel vem de uma Server Action, ou seja, de um endpoint HTTP público — o
 * tipo `Role` do TypeScript não vale nada em tempo de execução contra um POST
 * montado à mão. Sem esta checagem, o Prisma rejeitaria com erro de banco cru
 * (que não deve chegar à tela) em vez de uma mensagem tratada.
 */
function validarPapel(papel: string): Role {
  if (!PAPEIS.includes(papel as Role)) {
    throw new UsuarioInvalidoError("Papel inválido.");
  }
  return papel as Role;
}

function recusarContaDeSistema(id: string): void {
  if (ehContaDeSistema(id)) {
    throw new UsuarioInvalidoError("Esta conta é do sistema e não pode ser alterada.");
  }
}

/**
 * Impede a única mudança irreversível desta tela: deixar o sistema sem
 * nenhum administrador ativo. Não há caminho de recuperação pela interface —
 * quem restaura um ADMIN é outro ADMIN — então o estrago só se desfaz com
 * acesso direto ao banco.
 *
 * Conta apenas administradores **ativos e humanos**: contas de sistema ficam
 * de fora (`idsDeSistema()`) porque o robô do WhatsApp é ADMIN e não consegue
 * fazer login — deixá-lo entrar na conta faria o sistema autorizar a saída da
 * última pessoa de verdade.
 *
 * Chamado antes de desativar um ADMIN e antes de rebaixá-lo, que são os dois
 * caminhos para o mesmo fim.
 */
async function garantirQueSobraAdmin(idQueVaiSair: string): Promise<void> {
  const outros = await prisma.user.count({
    where: {
      papel: "ADMIN",
      ativo: true,
      // Os dois predicados de `id` no MESMO objeto — ver `sistema.ts` sobre
      // por que espalhar um fragmento com `id` silenciosamente descarta o
      // outro.
      id: { not: idQueVaiSair, notIn: idsDeSistema() },
    },
  });
  if (outros === 0) {
    throw new UsuarioInvalidoError(
      "Este é o último administrador ativo. Promova outra pessoa a administrador antes de mudar esta conta."
    );
  }
}

/**
 * O Prisma sinaliza violação de restrição única com o código `P2002`. Não
 * importamos `Prisma.PrismaClientKnownRequestError` para o `instanceof`
 * porque isso arrastaria o runtime do Prisma para dentro de um módulo que só
 * precisa ler um código de erro; a checagem estrutural basta e não quebra se
 * a classe mudar de lugar entre versões.
 */
function ehEmailDuplicado(erro: unknown): boolean {
  return typeof erro === "object" && erro !== null && "code" in erro && erro.code === "P2002";
}

export async function criarUsuario(dados: DadosNovoUsuario, autorId: string): Promise<UsuarioListado> {
  const nome = validarNome(dados.nome);
  const email = validarEmail(dados.email);
  const papel = validarPapel(dados.papel);
  const senha = validarSenha(dados.senha);

  const senhaHash = await bcrypt.hash(senha, CUSTO_BCRYPT);

  let criado;
  try {
    criado = await prisma.user.create({
      data: { nome, email, senhaHash, papel },
      select: { id: true, nome: true, email: true, papel: true, ativo: true, criadoEm: true },
    });
  } catch (erro) {
    // Deixamos o banco decidir, em vez de consultar antes: entre a consulta e
    // a escrita cabe outra criação com o mesmo e-mail, e o resultado seria
    // um erro cru de restrição única chegando à tela justamente na corrida.
    if (ehEmailDuplicado(erro)) {
      throw new UsuarioInvalidoError("Já existe uma conta com este e-mail.");
    }
    throw erro;
  }

  // `depois` NUNCA inclui `senhaHash`: `AuditLog.depois` é uma coluna Json
  // lida pelo dashboard ("atividade recente") e por qualquer consulta futura
  // ao histórico. Gravar o hash ali o espalharia para fora da única coluna
  // que deveria contê-lo.
  await registrarAuditoria({
    userId: autorId,
    acao: "criar_usuario",
    entidade: "User",
    entidadeId: criado.id,
    depois: { nome: criado.nome, email: criado.email, papel: criado.papel, ativo: criado.ativo },
  });

  return criado;
}

export async function atualizarUsuario(
  entrada: { id: string; nome: string; papel: Role },
  autorId: string
): Promise<UsuarioListado> {
  recusarContaDeSistema(entrada.id);

  const nome = validarNome(entrada.nome);
  const papel = validarPapel(entrada.papel);

  // `findUnique` por id, sem somar o filtro de conta de sistema:
  // `recusarContaDeSistema` acima já rejeitou esse caso, e tentar compor os
  // dois num único `where` foi exatamente o que produziu o bug do spread
  // descrito em `sistema.ts`.
  const antes = await prisma.user.findUnique({
    where: { id: entrada.id },
    select: { id: true, nome: true, email: true, papel: true, ativo: true },
  });
  if (!antes) throw new UsuarioInvalidoError("Usuário não encontrado.");

  // Trocar o próprio papel é um tiro no pé imediato: quem se rebaixa perde,
  // na mesma ação, o acesso à tela onde acabou de estar. Bloquear aqui é
  // mais claro do que deixar acontecer e a pessoa descobrir com um 404.
  if (entrada.id === autorId && papel !== antes.papel) {
    throw new UsuarioInvalidoError("Você não pode mudar o próprio papel.");
  }

  if (antes.papel === "ADMIN" && papel !== "ADMIN" && antes.ativo) {
    await garantirQueSobraAdmin(entrada.id);
  }

  const depois = await prisma.user.update({
    where: { id: entrada.id },
    data: { nome, papel },
    select: { id: true, nome: true, email: true, papel: true, ativo: true, criadoEm: true },
  });

  await registrarAuditoria({
    userId: autorId,
    acao: "editar_usuario",
    entidade: "User",
    entidadeId: depois.id,
    antes: { nome: antes.nome, papel: antes.papel },
    depois: { nome: depois.nome, papel: depois.papel },
  });

  return depois;
}

export async function definirAtivo(
  entrada: { id: string; ativo: boolean },
  autorId: string
): Promise<UsuarioListado> {
  recusarContaDeSistema(entrada.id);

  // Desativar a si mesmo derruba a própria sessão na navegação seguinte que
  // alcance o servidor (`usuarioAtual()` checa `ativo` a cada REQUISIÇÃO —
  // ela é memoizada por `cache()` dentro de um render, nunca entre eles).
  // Recuperar exige outro ADMIN, e se não houver, exige acesso ao banco.
  if (entrada.id === autorId && !entrada.ativo) {
    throw new UsuarioInvalidoError("Você não pode desativar a própria conta.");
  }

  const antes = await prisma.user.findUnique({
    where: { id: entrada.id },
    select: { id: true, papel: true, ativo: true },
  });
  if (!antes) throw new UsuarioInvalidoError("Usuário não encontrado.");

  if (antes.papel === "ADMIN" && antes.ativo && !entrada.ativo) {
    await garantirQueSobraAdmin(entrada.id);
  }

  const depois = await prisma.user.update({
    where: { id: entrada.id },
    data: { ativo: entrada.ativo },
    select: { id: true, nome: true, email: true, papel: true, ativo: true, criadoEm: true },
  });

  await registrarAuditoria({
    userId: autorId,
    acao: entrada.ativo ? "ativar_usuario" : "desativar_usuario",
    entidade: "User",
    entidadeId: depois.id,
    antes: { ativo: antes.ativo },
    depois: { ativo: depois.ativo },
  });

  return depois;
}

/**
 * Redefine a senha de outra pessoa.
 *
 * Não estava no recorte original desta fatia, e foi acrescentado por um
 * motivo concreto: **não existe fluxo de "esqueci minha senha" neste
 * sistema**. Sem uma redefinição pela tela, um vendedor que esquece a senha
 * volta a depender de alguém rodar script com acesso ao banco — que é
 * exatamente a dependência que esta fatia existe para cortar.
 *
 * A senha nova nunca é registrada em lugar nenhum além do próprio
 * `senhaHash`: o audit log guarda que houve redefinição e quem fez, sem
 * `antes` nem `depois`, porque não há nada aqui que seja seguro guardar.
 */
export async function redefinirSenha(
  entrada: { id: string; senha: string },
  autorId: string
): Promise<void> {
  recusarContaDeSistema(entrada.id);

  const senha = validarSenha(entrada.senha);

  const alvo = await prisma.user.findUnique({ where: { id: entrada.id }, select: { id: true } });
  if (!alvo) throw new UsuarioInvalidoError("Usuário não encontrado.");

  const senhaHash = await bcrypt.hash(senha, CUSTO_BCRYPT);
  await prisma.user.update({ where: { id: alvo.id }, data: { senhaHash } });

  await registrarAuditoria({
    userId: autorId,
    acao: "redefinir_senha",
    entidade: "User",
    entidadeId: alvo.id,
  });
}
