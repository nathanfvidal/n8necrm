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
 * Depois disso, unifica o 9º dígito do celular (ver `unificarNonoDigitoCelular`
 * abaixo) e valida que sobrou um número de telefone plausível (ver a checagem
 * final) antes de devolver.
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

  const semCodigoPais =
    (digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")
      ? digitos.slice(2)
      : digitos;

  const normalizado = unificarNonoDigitoCelular(semCodigoPais);

  // "Usável" = um número de telefone brasileiro completo: DDD (2 dígitos) +
  // assinante (8 para fixo, 9 para celular já unificado) = 10 ou 11 dígitos
  // no total. Qualquer outra contagem — "" (nada extraído de "N/A", "a
  // definir", string vazia), ou algo curto/incompleto demais para ter DDD —
  // não é um telefone de verdade e não deve virar chave de dedupe: duas
  // pessoas diferentes cadastradas sem telefone (ou com lixo no campo)
  // colidiriam na constraint UNIQUE de `Contact.telefone` e virariam UM
  // contato só, fundindo o histórico de duas pessoas distintas — o mesmo
  // tipo de dano (fusão irreversível) que a regra do 9º dígito abaixo evita
  // no lado do celular/fixo. Preferimos rejeitar alto e cedo, com uma
  // mensagem clara, a deixar isso silenciosamente virar dedupe key.
  if (normalizado.length !== 10 && normalizado.length !== 11) {
    throw new Error(
      `Telefone inválido: "${telefone}" não contém um número de telefone brasileiro reconhecível ` +
        `(esperado DDD + 8 dígitos para fixo ou DDD + 9 dígitos para celular; encontrei ` +
        `${normalizado.length} dígito(s) depois de normalizar).`
    );
  }

  return normalizado;
}

// Faixas do plano de numeração da Anatel (Resolução nº 553/2010, "6º dígito"
// nacionalizado como "9º dígito" até jul/2016): o número de assinante (sem
// DDD) tem 8 dígitos para linha fixa e 9 para celular, e o celular sempre
// começa com "9" nesse formato. Antes da universalização do 9º dígito, o
// celular já tinha 8 dígitos de assinante, e a faixa de fixo (2-5) nunca se
// sobrepôs à faixa de celular (6-9) — são canais de numeração reservados
// separadamente, nunca compartilhados entre os dois serviços. Isso é o que
// torna a regra abaixo segura: o primeiro dígito do assinante, sozinho, basta
// para diferenciar "celular sem o 9º dígito" (6-9) de "fixo" (2-5), sem
// precisar de nenhuma outra informação sobre o número.
const PRIMEIRO_DIGITO_CELULAR_SEM_NONO_DIGITO = new Set(["6", "7", "8", "9"]);

/**
 * Insere o 9º dígito em celulares digitados no formato antigo (10 dígitos:
 * DDD + 8 dígitos de assinante), unificando com o formato atual (11 dígitos:
 * DDD + "9" + 8 dígitos) — sem isso, "1188887777" e "11988887777" são o
 * mesmo celular da mesma pessoa, mas normalizam para chaves diferentes e
 * criam dois `Contact` para ela.
 *
 * A parte perigosa: um número de 10 dígitos também pode ser uma linha FIXA
 * (DDD + 8 dígitos), e fixo nunca ganha 9º dígito. Inserir "9" num fixo não
 * "corrigiria" nada — fundiria esse fixo com o celular que por acaso
 * compartilha os mesmos 8 últimos dígitos, ou seja, fundiria duas PESSOAS
 * diferentes num Contact só. Isso é pior do que não deduplicar: é
 * irreversível sem investigação manual.
 *
 * Por isso só mexemos quando o primeiro dígito do assinante (posição
 * imediatamente após o DDD) está nas faixas reservadas a celular no formato
 * antigo (6, 7, 8 ou 9 — ver a constante acima). Primeiro dígito em 2-5 é
 * fixo: devolvemos sem alterar. Primeiro dígito em 0 ou 1 não corresponde a
 * nenhuma faixa documentada do plano de numeração (não é usado nem por fixo
 * nem por celular) — é um caso ambíguo/inválido, e devolvemos sem alterar
 * também: não dedupliza esse caso, mas também não arrisca fundir duas
 * pessoas por causa de um número já estranho.
 *
 * Números que já chegam com 11 dígitos (celular já no formato atual, sempre
 * começando com "9") passam direto, sem qualquer alteração — esta função só
 * atua sobre entradas de exatamente 10 dígitos.
 */
function unificarNonoDigitoCelular(digitos: string): string {
  if (digitos.length !== 10) return digitos;

  const ddd = digitos.slice(0, 2);
  const assinante = digitos.slice(2);
  const primeiroDigitoAssinante = assinante.charAt(0);

  if (PRIMEIRO_DIGITO_CELULAR_SEM_NONO_DIGITO.has(primeiroDigitoAssinante)) {
    return `${ddd}9${assinante}`;
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
 * ## NÃO "conserte" isso para atualizar o contato
 *
 * Desde que `Contact` virou cadastro de pessoa (empresa, cargo, documento,
 * endereço, observações), a regra de nunca sobrescrever ficou MAIS certa, não
 * menos. Um lead que chega pelo WhatsApp traz nome e telefone e nada mais —
 * deixá-lo escrever no contato apagaria empresa e cargo que alguém curou à
 * mão, trocando dado trabalhado por dado bruto sem ninguém pedir. Quem corrige
 * cadastro é `atualizarContato` (`core/contacts/service.ts`), pela tela, com
 * autor registrado em `AuditLog`. Esta função só liga lead a pessoa.
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
