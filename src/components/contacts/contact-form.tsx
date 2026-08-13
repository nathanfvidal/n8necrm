"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { atualizarContatoAction, criarContatoAction } from "@/core/contacts/actions";
import { UFS } from "@/core/contacts/schema";

// Validação de cliente rasa de propósito, como nos outros formulários deste
// projeto: quem decide o que é um telefone válido é `normalizarTelefone` no
// servidor (código do país, 9º dígito do celular, recusa de número
// incompleto), e o que é um documento ou uma UF válidos é
// `camposCadastraisSchema` (`core/contacts/schema.ts`). Repetir as regras aqui
// criaria duas verdades que divergem na primeira mudança — e um POST direto
// não passaria por esta nem por acaso.
const schema = z.object({
  nome: z.string().min(1, "Informe o nome"),
  telefone: z.string().min(1, "Informe o telefone"),
  email: z.string().optional(),
  empresa: z.string().optional(),
  cargo: z.string().optional(),
  documento: z.string().optional(),
  endereco: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().optional(),
  observacoes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

// `<select>` nativo e não `ui/select.tsx` (Base UI), pelo mesmo motivo já
// registrado em `task-form.tsx`: o componente da casa renderiza um listbox em
// portal, que não existe sem JavaScript. Aqui a lista é fechada, tem 27 itens
// e nunca muda — o nativo é acessível por padrão e alcançável por `getByLabel`
// sem truque.
const CLASSES_SELECT =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

const VAZIO: FormValues = {
  nome: "",
  telefone: "",
  email: "",
  empresa: "",
  cargo: "",
  documento: "",
  endereco: "",
  cidade: "",
  uf: "",
  observacoes: "",
};

export type ContatoEditavel = {
  id: string;
  nome: string;
  telefone: string;
  email: string | null;
  empresa: string | null;
  cargo: string | null;
  documento: string | null;
  endereco: string | null;
  cidade: string | null;
  uf: string | null;
  observacoes: string | null;
};

/**
 * Formulário de contato, usado nas duas pontas: cadastro avulso em
 * `/contatos` (sem `contato`) e edição em `/contatos/[id]` (com `contato`).
 *
 * Um componente só porque os campos e as regras são idênticos — o que muda é
 * qual action é chamada e se o formulário se limpa no fim. Dois componentes
 * quase iguais divergiriam na primeira vez que alguém acrescentasse um campo
 * num deles — e agora são dez campos, não três.
 *
 * ## Um `<form>` só, quatro `<fieldset>`
 *
 * `tests/e2e/contatos.spec.ts` localiza o formulário por
 * `page.locator("form").filter({ has: botão "Adicionar contato" })`. Dividir
 * as seções em formulários separados quebraria aquele localizador E o envio
 * (cada `<form>` submeteria só a própria parte). `FieldSet` agrupa
 * visualmente e semanticamente sem criar um segundo formulário — é exatamente
 * para isso que `<fieldset>` existe.
 *
 * ## Nenhum rótulo novo pode ser exatamente "Nome" ou "Telefone"
 *
 * O mesmo e2e usa `getByLabel("Nome", { exact: true })`. "Nome fantasia" seria
 * seguro; um segundo campo rotulado só "Nome" tornaria o localizador ambíguo e
 * derrubaria o teste com erro de modo estrito — que se parece com defeito de
 * aplicação e não é.
 */
export function ContactForm({ contato }: { contato?: ContatoEditavel }) {
  const router = useRouter();
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: contato
      ? {
          nome: contato.nome,
          telefone: contato.telefone,
          // `?? ""` em cada um: um `<input>` com `value={null}` vira campo não
          // controlado no meio do caminho, e o React reclama em console.
          email: contato.email ?? "",
          empresa: contato.empresa ?? "",
          cargo: contato.cargo ?? "",
          documento: contato.documento ?? "",
          endereco: contato.endereco ?? "",
          cidade: contato.cidade ?? "",
          uf: contato.uf ?? "",
          observacoes: contato.observacoes ?? "",
        }
      : VAZIO,
  });

  async function onSubmit(data: FormValues) {
    setErroEnvio(null);
    setSalvo(false);

    // As strings vazias seguem CRUAS para o servidor, sem virar `undefined`.
    // É deliberado e é o que torna "apagar um campo" alcançável pela tela:
    // `camposCadastraisSchema` converte vazio em `null`, e `null` no `update`
    // do Prisma significa "apague o que está lá". Mandar `undefined` diria
    // "não mexa nesta coluna", e limpar a empresa de alguém seria impossível.
    const resultado = contato
      ? await atualizarContatoAction({ id: contato.id, ...data })
      : await criarContatoAction(data);

    if (!resultado.ok) {
      // Sem `reset` no erro. Vale em dobro aqui: a falha mais provável é o
      // telefone já pertencer a outra pessoa, e a mensagem diz de quem é —
      // apagar o que foi digitado tiraria o contexto junto.
      setErroEnvio(resultado.erro);
      return;
    }

    if (!contato) reset(VAZIO);
    setSalvo(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <FieldGroup>
        <FieldSet>
          <FieldLegend variant="label">Identificação</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="nome">Nome</FieldLabel>
              <Input id="nome" {...register("nome")} />
              <FieldError errors={[errors.nome]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="telefone">Telefone</FieldLabel>
              <Input id="telefone" placeholder="(11) 99999-8888" {...register("telefone")} />
              <FieldError errors={[errors.telefone]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="email">E-mail</FieldLabel>
              <Input id="email" type="email" {...register("email")} />
              <FieldError errors={[errors.email]} />
            </Field>
          </div>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">Empresa</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="empresa">Empresa</FieldLabel>
              <Input id="empresa" {...register("empresa")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="cargo">Cargo</FieldLabel>
              <Input id="cargo" {...register("cargo")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="documento">Documento</FieldLabel>
              <Input id="documento" placeholder="CPF ou CNPJ" {...register("documento")} />
            </Field>
          </div>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">Endereço</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr_auto]">
            <Field>
              <FieldLabel htmlFor="endereco">Logradouro</FieldLabel>
              <Input id="endereco" {...register("endereco")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="cidade">Cidade</FieldLabel>
              <Input id="cidade" {...register("cidade")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="uf">UF</FieldLabel>
              <select id="uf" className={CLASSES_SELECT} {...register("uf")}>
                <option value="">—</option>
                {UFS.map((sigla) => (
                  <option key={sigla} value={sigla}>
                    {sigla}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">Observações</FieldLegend>
          <Field>
            <FieldLabel htmlFor="observacoes">Observações</FieldLabel>
            <Textarea id="observacoes" rows={4} {...register("observacoes")} />
          </Field>
        </FieldSet>
      </FieldGroup>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Salvando..." : contato ? "Salvar alterações" : "Adicionar contato"}
        </Button>

        {erroEnvio && (
          <p role="alert" className="text-sm text-red-600">
            {erroEnvio}
          </p>
        )}

        {salvo && !erroEnvio && (
          <p role="status" className="text-sm text-green-700">
            Contato salvo.
          </p>
        )}
      </div>
    </form>
  );
}
