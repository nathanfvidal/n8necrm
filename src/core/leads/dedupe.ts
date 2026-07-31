import { Prisma } from "@prisma/client";
import type { Contact } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Normaliza um telefone brasileiro para a forma canônica usada como chave de
 * deduplicação: só dígitos, sem código do país, DDD + número (10 dígitos
 * para fixo, 11 para celular com o 9º dígito).
 *
 * Existe porque a mesma pessoa acaba digitada de formas diferentes em dias
 * diferentes — "11999998888", "(11) 99999-8888", "+55 11 99999-8888",
 * "11 9 9999-8888" — e `Contact.telefone` é UNIQUE no schema. Sem normalizar
 * antes de comparar/gravar, cada variação de formatação cria uma pessoa nova
 * no banco (a constraint UNIQUE não pega isso, porque as strings são
 * literalmente diferentes) — exatamente a duplicação que esta função existe
 * para evitar.
 *
 * Regra para o código do país: depois de remover tudo que não é dígito, se
 * sobrarem 12 ou 13 dígitos E o resultado começar com "55", removemos esse
 * prefixo (13 = "55" + DDD(2) + celular(9); 12 = "55" + DDD(2) + fixo(8)).
 * Não removemos "55" de um número de 10/11 dígitos que por acaso comece com
 * 55 (ex.: DDD 55 = Santa Catarina/RS) — nesse caso "55" é o DDD, não o
 * código do país, e o comprimento total denuncia a diferença.
 *
 * O seed da Task 9 já grava telefones só com dígitos e sem "+55"
 * (`1199999000{0..3}`), então essa normalização é uma no-op sobre os dados
 * existentes — nenhum backfill é necessário para os contatos já no banco.
 * Isso NÃO cobre retroativamente contatos que viessem a ser gravados fora
 * desta função com formatação (parênteses, hífen, "+55") — hoje não existe
 * nenhum, mas se aparecerem antes de todo caminho de escrita passar por
 * `encontrarOuCriarContact`, um backfill explícito seria necessário depois.
 */
export function normalizarTelefone(telefone: string): string {
  const digitos = telefone.replace(/\D/g, "");

  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) {
    return digitos.slice(2);
  }

  return digitos;
}

/**
 * Encontra o `Contact` cujo telefone (normalizado) bate com `dados.telefone`
 * ou cria um novo quando nenhum existe. É o ponto único de dedupe de contato
 * por telefone — chamado de todo caminho de criação de lead (hoje: entrada
 * manual; Fase 2: formulário público e clique de WhatsApp).
 *
 * Nunca sobrescreve `nome`/`email` de um contato já existente: a primeira
 * gravação "ganha" o nome do contato, e um telefone reenviado depois (ex.:
 * lead voltando 6 meses depois) só é associado ao histórico já existente,
 * não usado para editar o cadastro.
 *
 * ## Concorrência
 *
 * Duas chamadas simultâneas para o mesmo telefone podem ambas passar pelo
 * `findUnique` abaixo antes de qualquer uma criar a linha (nenhuma ainda viu
 * o registro da outra) e ambas tentarem `create`. O Postgres permite só uma:
 * a segunda colide na constraint UNIQUE de `Contact.telefone` e o Prisma
 * traduz isso em `PrismaClientKnownRequestError` código `P2002`. Em vez de
 * propagar esse erro pra quem chamou — que veria uma falha na criação do
 * lead por causa de uma corrida interna irrelevante pra ela — tratamos como
 * "alguém ganhou a corrida antes de mim": buscamos de novo por telefone e
 * devolvemos o contato que já existe. Isso é o que garante, sob concorrência
 * real (o formulário público da Fase 2 torna isso alcançável por tráfego
 * real), que a função nunca duplica um contato nem lança erro pro caminho de
 * criação de lead por causa dessa corrida — provado por um teste com
 * `Promise.all` em tests/unit/dedupe.test.ts.
 */
export async function encontrarOuCriarContact(dados: {
  nome: string;
  telefone: string;
  email?: string;
}): Promise<Contact> {
  const telefone = normalizarTelefone(dados.telefone);

  const existente = await prisma.contact.findUnique({ where: { telefone } });
  if (existente) return existente;

  try {
    return await prisma.contact.create({
      data: { nome: dados.nome, telefone, email: dados.email },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      const contatoDaCorrida = await prisma.contact.findUnique({ where: { telefone } });
      if (contatoDaCorrida) return contatoDaCorrida;
    }
    throw erro;
  }
}
