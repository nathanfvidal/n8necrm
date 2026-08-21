import { Badge } from "@/components/ui/badge";

/**
 * "Desligado" e não "Inativo": um fluxo desligado é um estado que alguém
 * escolheu, e a palavra precisa deixar claro que não é defeito nem erro.
 *
 * `variant="outline"` para "Ativo", não o `default` (cor primária da marca)
 * que este componente usava antes. Primária é cor de AÇÃO nesta base — é o
 * que `<Button>` usa para o botão que a pessoa deve clicar — e "Ativo" é
 * ESTADO, não ação; usar a mesma cor para os dois deixa a tela sugerindo que
 * "Ativo" é algo para clicar. `outline` (borda, sem preenchimento) marca
 * presença sem competir com os botões reais da linha (Ativar/Desativar,
 * ambos `variant="outline"` também — mesma família visual, o que é
 * proposital: um selo de estado ao lado de um botão de ação não deveria ter
 * MAIS peso visual que o próprio botão). "Desligado" continua em
 * `secondary`: os dois estados ficam claramente diferentes um do outro, e
 * nenhum dos dois usa a cor reservada para ação.
 */
export function StatusFluxo({ ativo }: { ativo: boolean }) {
  return ativo ? <Badge variant="outline">Ativo</Badge> : <Badge variant="secondary">Desligado</Badge>;
}
