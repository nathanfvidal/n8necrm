import { Html, Body, Container, Text, Heading } from "@react-email/components";

/**
 * Template do e-mail "novo lead recebido", renderizado por `dispatch.ts`
 * (`notificarNovoLead`) e passado como `react` para `resend.emails.send`.
 *
 * Sem `import "server-only"`: `@react-email/components` é JSX puro, sem
 * Prisma nem nada sensível a segredo — nada aqui precisa (nem deveria)
 * bloquear import de um Client Component, embora hoje nenhum importe.
 */
export function NovoLeadEmail({ contatoNome, etapaNome }: { contatoNome: string; etapaNome: string }) {
  return (
    <Html>
      <Body style={{ fontFamily: "sans-serif" }}>
        <Container>
          <Heading>Novo lead recebido</Heading>
          <Text>
            {contatoNome} entrou no funil na etapa &quot;{etapaNome}&quot;.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
