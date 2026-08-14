// Ajuda para testes que varrem o CÓDIGO-FONTE como texto, em vez de executá-lo.
//
// Dois testes precisam disso: `consultas-estreitas.test.ts` (nenhuma relação
// para `User` ou `Contact` carregada inteira) e `listagem-consulta.test.ts` (o
// painel conta no banco, sem teto). Nos dois, o inimigo é o mesmo: este projeto
// documenta as próprias regras em comentário longo, e a prosa que EXPLICA a
// regra cita o padrão proibido — literalmente, com o mesmo texto. Sem remover
// comentário, todo teste desses reprova a documentação da regra que ele existe
// para defender. Aconteceu na primeira execução das duas varreduras.

/**
 * Devolve o código sem comentários, com a numeração de linhas preservada.
 *
 * Duas armadilhas resolvidas aqui, as duas descobertas quebrando:
 *
 * 1. **CRLF.** Este projeto é editado no Windows e os arquivos terminam em
 *    `\r\n`. Depois de `split("\n")` sobra um `\r` no fim de cada linha, e aí
 *    `/\/\/.*$/` NÃO casa: `.` não atravessa `\r`, e `$` (sem a flag `m`) só
 *    aceita fim de string ou um `\n` final. O removedor de comentários deixa
 *    de remover qualquer coisa, em silêncio.
 * 2. **Numeração.** Apagar um bloco `/* *\/` inteiro engole as quebras de linha
 *    dele, e todo número reportado depois sai deslocado — apontando para o
 *    lugar errado exatamente quando alguém precisa do apontamento. O bloco é
 *    trocado por quebras equivalentes.
 *
 * O `//` só conta como início de comentário quando não vem depois de `:`, para
 * `"https://..."` não ser cortado no meio. É a única ambiguidade que aparece
 * neste código; aspas em geral não são tratadas.
 */
export function semComentarios(codigo: string): string {
  return codigo
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, (bloco) => "\n".repeat((bloco.match(/\n/g) ?? []).length))
    .split("\n")
    .map((linha) => linha.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}
