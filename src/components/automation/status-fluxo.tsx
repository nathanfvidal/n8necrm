import { Badge } from "@/components/ui/badge";

/**
 * "Desligado" e não "Inativo": um fluxo desligado é um estado que alguém
 * escolheu, e a palavra precisa deixar claro que não é defeito nem erro.
 */
export function StatusFluxo({ ativo }: { ativo: boolean }) {
  return ativo ? <Badge>Ativo</Badge> : <Badge variant="secondary">Desligado</Badge>;
}
