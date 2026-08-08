"use client";

import { mascararValorBR } from "@/lib/dinheiro";

/**
 * Campo de dinheiro que não deixa digitar separador.
 *
 * A pessoa digita só algarismos e o valor se monta pela direita, como caixa
 * de banco: "150050" vira "1.500,50". Isso não é enfeite — "1.500" digitado
 * livremente é ambíguo entre 1500 e 1,5, e nenhuma regra resolve isso pelo
 * texto (ver `src/lib/dinheiro.ts`). Tirando o separador do teclado, a
 * ambiguidade deixa de existir, e a ordem de grandeza aparece formada na
 * tela — que é a conferência que protege contra confundir 150 mil com 1,5
 * milhão.
 *
 * Os algarismos são CENTAVOS: quem digita `15050` vê `150,50`.
 *
 * `type="text"` e não `type="number"`: `number` recusaria os pontos e
 * vírgulas que a máscara produz. `inputMode="numeric"` abre o teclado
 * numérico no celular sem essa restrição.
 *
 * Campo controlado: `value` é sempre o texto já mascarado, e `onChange`
 * devolve o texto mascarado — nunca os algarismos crus. Assim o que o
 * formulário guarda é exatamente o que a pessoa vê, e é isso que
 * `parseValorBR` recebe no servidor.
 */
export function CampoDinheiro({
  value,
  onChange,
  label,
  id = "valorEstimado",
}: {
  value: string;
  onChange: (valor: string) => void;
  label: string;
  id?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">R$</span>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          className="w-full rounded-md border px-3 py-2 text-sm"
          value={value}
          placeholder="0,00"
          // `mascararValorBR("")` devolve "" (e não "0,00"), que é o que
          // permite esvaziar o campo — string vazia é como o formulário
          // manda "limpe o valor" e vira `null` no banco.
          onChange={(evento) => onChange(mascararValorBR(evento.target.value))}
        />
      </div>
    </div>
  );
}
