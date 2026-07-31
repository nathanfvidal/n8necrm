"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarLeadManual } from "@/core/leads/actions";

/**
 * Validação client-side é deliberadamente mais permissiva que
 * `normalizarTelefone` (src/core/leads/dedupe.ts) — checa só "tem dígitos
 * suficientes pra ser um telefone", não a regra completa (DDD + 8/9 dígitos
 * depois de remover código do país e unificar o 9º dígito). As duas não
 * podem DIVERGIR na direção perigosa: se este schema fosse mais estrito que
 * o servidor, rejeitaria no cliente um telefone que o servidor aceitaria.
 * Ele pode ser mais permissivo (deixa passar algo que o servidor ainda vai
 * rejeitar) porque `criarLeadManual` sempre valida de novo e o formulário
 * trata esse erro (ver `mensagemDeErro` abaixo) — a validação real e
 * definitiva mora no servidor, isto aqui só evita o roundtrip óbvio (campo
 * vazio, "abc", um dígito solto).
 */
const schema = z.object({
  nome: z.string().trim().min(2, "Informe o nome"),
  telefone: z
    .string()
    .trim()
    .min(1, "Informe o telefone")
    .refine((valor) => {
      const digitos = valor.replace(/\D/g, "");
      return digitos.length >= 10 && digitos.length <= 13;
    }, "Telefone precisa ter DDD + número (ex.: (11) 98888-7777)"),
  email: z.string().trim().email("E-mail inválido").optional().or(z.literal("")),
  responsavelId: z.string().min(1, "Escolha o responsável"),
});

type FormValues = z.infer<typeof schema>;

type Vendedor = { id: string; nome: string };

/**
 * Traduz o que `criarLeadManual` pode lançar (ver actions.ts) numa mensagem
 * segura para exibir a quem preencheu o formulário, sem vazar detalhe de
 * infraestrutura para o caso genérico (banco fora do ar etc.).
 *
 * Dois modos de falha ESPERADOS, cada um com mensagem própria:
 * - Telefone inválido: `encontrarOuCriarContact` (Task 12) rejeitou o
 *   telefone — a mensagem já vem pronta para leitura humana.
 * - Autorização/sessão: `usuarioAtual()` rejeita sessão ausente OU usuário
 *   desativado com a mesma mensagem ("Não autenticado" — ver o comentário em
 *   src/core/auth/session.ts sobre por que isso é de propósito); "Sem
 *   permissão para criar lead" é o outro gate em actions.ts. Qualquer coisa
 *   fora dessas três cai no fallback genérico.
 */
function mensagemDeErro(erro: unknown): string {
  if (erro instanceof Error) {
    if (/^Telefone inválido/.test(erro.message)) {
      return erro.message;
    }
    if (erro.message === "Sem permissão para criar lead") {
      return erro.message;
    }
    if (erro.message === "Não autenticado") {
      return "Sua sessão expirou ou sua conta foi desativada. Atualize a página e faça login novamente.";
    }
  }
  return "Não foi possível criar o lead. Tente novamente em instantes.";
}

export function LeadForm({
  responsavelPadraoId,
  nomeUsuario,
  vendedores,
  podeAtribuirOutraPessoa,
}: {
  responsavelPadraoId: string;
  nomeUsuario: string;
  vendedores: Vendedor[];
  podeAtribuirOutraPessoa: boolean;
}) {
  const router = useRouter();
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      nome: "",
      telefone: "",
      email: "",
      responsavelId: responsavelPadraoId,
    },
  });

  async function onSubmit(data: FormValues) {
    setErroEnvio(null);
    setSucesso(false);

    // Nenhum identificador de autor é enviado: a action deriva quem age da
    // sessão (ver decisão de segurança da Task 13). `criarLeadManual` PODE
    // lançar (telefone inválido, sem permissão, sessão inválida) — por isso
    // fica dentro do try: uma falha esperada de validação não pode virar uma
    // exceção não tratada nem apagar o que a pessoa digitou.
    try {
      await criarLeadManual({
        nome: data.nome,
        telefone: data.telefone,
        email: data.email || undefined,
        responsavelId: data.responsavelId,
      });
      reset({ nome: "", telefone: "", email: "", responsavelId: responsavelPadraoId });
      setSucesso(true);
      router.refresh();
    } catch (erro) {
      // De propósito NÃO chamamos `reset` aqui: em caso de erro a pessoa não
      // pode perder o que já preencheu (ela só quer corrigir o telefone, não
      // digitar tudo de novo).
      setErroEnvio(mensagemDeErro(erro));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="nome">Nome</Label>
        <Input id="nome" {...register("nome")} />
        {errors.nome && <p className="text-xs text-red-600">{errors.nome.message}</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="telefone">Telefone</Label>
        <Input id="telefone" {...register("telefone")} placeholder="(11) 98888-7777" />
        {errors.telefone && <p className="text-xs text-red-600">{errors.telefone.message}</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" {...register("email")} />
        {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="responsavelId">Responsável</Label>
        {podeAtribuirOutraPessoa ? (
          <select
            id="responsavelId"
            {...register("responsavelId")}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            {vendedores.map((vendedor) => (
              <option key={vendedor.id} value={vendedor.id}>
                {vendedor.nome}
              </option>
            ))}
          </select>
        ) : (
          // VENDEDOR nunca consegue atribuir lead a outra pessoa —
          // `criarLeadManual` clampa `responsavelId` no servidor para o
          // próprio autor sempre que quem chama não tem `ver_dashboard_geral`
          // (ver actions.ts). Oferecer aqui um <select> com outros nomes
          // prometeria uma escolha que seria descartada em silêncio; em vez
          // disso mostramos só o próprio nome, sem opção de troca.
          //
          // Dois elementos, de propósito, não um só: `<input type="hidden">`
          // não é "labelable" pela spec de HTML (a lista de elementos que um
          // `<label for>` pode apontar exclui explicitamente
          // `input[type=hidden]`), então associar o Label acima a ele seria
          // uma associação tão inválida quanto a anterior (que apontava para
          // um `<p>`, também não-labelable). Em vez disso: um `<input>`
          // visível, desabilitado, só para exibição — esse SIM é labelable,
          // é o que `id="responsavelId"` recebe — e um `<input type="hidden">`
          // à parte, sem id/label (não precisa: nunca é percebido nem
          // interagido), carregando o valor de verdade via `register`.
          <>
            <Input
              id="responsavelId"
              value={`Você (${nomeUsuario})`}
              disabled
              readOnly
              aria-readonly="true"
            />
            <input type="hidden" {...register("responsavelId")} />
          </>
        )}
        {errors.responsavelId && (
          <p className="text-xs text-red-600">{errors.responsavelId.message}</p>
        )}
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Salvando..." : "Adicionar lead"}
      </Button>

      {erroEnvio && (
        <p role="alert" className="w-full text-sm text-red-600">
          {erroEnvio}
        </p>
      )}
      {sucesso && !erroEnvio && (
        <p className="w-full text-sm text-green-600">Lead criado com sucesso.</p>
      )}
    </form>
  );
}
