// Módulo puro (sem Prisma, sem `import "dotenv/config"`, sem invocação de
// topo de arquivo) compartilhado por prisma/seed-demo.ts e
// prisma/seed-demo-limpar.ts.
//
// Existe separado dos dois por um motivo específico, não por organização:
// seed-demo.ts termina com `if (!process.env.VITEST) { seedDemo()... }` no
// topo do arquivo (mesma guarda de prisma/seed.ts, para permitir importar a
// função a partir de um teste sem also disparar a execução). Se
// seed-demo-limpar.ts importasse `TELEFONE_PREFIXO_DEMO` DIRETO de
// `./seed-demo`, o simples `import` já executaria esse módulo inteiro —
// disparando `seedDemo()` como efeito colateral de rodar a LIMPEZA. Foi
// exatamente isso que aconteceu ao testar este script pela primeira vez:
// `npm run seed:demo:limpar` apagou os dados de demo e, na sequência, o
// próprio import recriou tudo de novo, porque `process.env.VITEST` não está
// definido numa execução de CLI real. Um módulo compartilhado sem
// side-effect nenhum no topo elimina essa classe de bug por construção — não
// há nada que uma importação deste arquivo possa disparar além de ler uma
// constante/função pura.
export const TELEFONE_PREFIXO_DEMO = "11930";

export function telefoneDemo(indiceContato: number): string {
  // "11930" (5) + 6 dígitos = 11 dígitos totais (DDD 2 + 9 + assinante 8).
  return `${TELEFONE_PREFIXO_DEMO}${String(indiceContato).padStart(6, "0")}`;
}

// Confere, na criação de cada telefone, os mesmos invariantes que
// `normalizarTelefone` (src/core/leads/dedupe.ts) exige de um telefone
// brasileiro válido — não uma cópia da função (seed-demo.ts não a importa,
// ver comentário no topo daquele arquivo sobre `server-only`), só uma rede de
// segurança para pegar um erro de digitação no gerador antes de gravar no
// banco: 11 dígitos, DDD 11, celular (9 na 3ª posição), dentro do bloco
// reservado para demo.
export function assertTelefoneCanonico(telefone: string): void {
  if (!/^11930\d{6}$/.test(telefone)) {
    throw new Error(
      `Telefone de demo fora do formato esperado: "${telefone}" — deveria ter 11 dígitos e começar com "11930".`
    );
  }
}
