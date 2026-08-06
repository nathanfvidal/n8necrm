import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Storage } from "../../src/lib/storage";

// Bytes iniciais reais de cada formato — o mesmo que o navegador e o `file(1)`
// olham. Usar bytes de verdade (e não `Buffer.from("png")`) é o ponto: o
// teste tem que falhar se a conferência de assinatura for afrouxada.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from("WEBP", "ascii"),
  Buffer.from([0, 0, 0, 0]),
]);
const WAV_QUE_FINGE_SER_WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from("WAVE", "ascii"),
  Buffer.from([0, 0, 0, 0]),
]);
const HTML_COM_SCRIPT = Buffer.from("<html><script>alert(1)</script></html>", "utf8");

class FakeStorage implements Storage {
  private arquivos = new Map<string, { file: Buffer; contentType: string }>();

  async upload(path: string, file: Buffer, contentType: string): Promise<string> {
    this.arquivos.set(path, { file, contentType });
    return path;
  }

  async urlAssinada(path: string): Promise<string> {
    return `https://fake-storage.local/${path}?token=fake`;
  }

  async delete(path: string): Promise<void> {
    this.arquivos.delete(path);
  }

  has(path: string): boolean {
    return this.arquivos.has(path);
  }
}

describe("Storage (contrato)", () => {
  it("upload devolve o PATH, não uma URL — URL de bucket privado expira e não pode ser persistida", async () => {
    const fake = new FakeStorage();
    const retorno = await fake.upload("itens/foto.webp", WEBP, "image/webp");
    expect(retorno).toBe("itens/foto.webp");
  });

  it("urlAssinada devolve uma URL temporária para o path", async () => {
    const fake = new FakeStorage();
    const url = await fake.urlAssinada("itens/foto.webp");
    expect(url).toContain("itens/foto.webp");
  });

  it("delete remove o arquivo previamente enviado", async () => {
    const fake = new FakeStorage();
    await fake.upload("itens/foto.webp", WEBP, "image/webp");
    await fake.delete("itens/foto.webp");
    expect(fake.has("itens/foto.webp")).toBe(false);
  });
});

// A suíte acima só exercita a lógica trivial do FakeStorage (nunca falha por
// construção). Esta suíte exercita a SupabaseStorage real, com o cliente
// @supabase/supabase-js mockado via vi.mock — sem rede, sem credenciais, sem
// bucket real — para garantir que uma regressão na implementação (bucket
// errado, contentType perdido, validação removida, erro engolido) derrube o
// teste.
const { createClientMock, fromMock, uploadMock, createSignedUrlMock, removeMock } = vi.hoisted(
  () => {
    const uploadMock = vi.fn();
    const createSignedUrlMock = vi.fn();
    const removeMock = vi.fn();
    const fromMock = vi.fn(() => ({
      upload: uploadMock,
      createSignedUrl: createSignedUrlMock,
      remove: removeMock,
    }));
    const createClientMock = vi.fn(() => ({ storage: { from: fromMock } }));
    return { createClientMock, fromMock, uploadMock, createSignedUrlMock, removeMock };
  }
);

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server", que o Next.js aplica no build de Server Components. Fora
// desse pipeline (aqui, sob Vitest) ele sempre lança, independente de quem
// importa — por isso é mockado apenas neste arquivo de teste. Isso não
// enfraquece a guarda em produção: o import real em src/lib/storage.ts
// continua intacto e só é substituído dentro deste processo de teste.
vi.mock("server-only", () => ({}));

vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function carregarModulo() {
  vi.resetModules();
  process.env.SUPABASE_URL = "https://exemplo.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-service-role-de-teste";
  return import("../../src/lib/storage");
}

async function criarSupabaseStorage(): Promise<Storage> {
  return (await carregarModulo()).storage;
}

describe("SupabaseStorage (implementação real, cliente Supabase mockado)", () => {
  beforeEach(() => {
    createClientMock.mockClear();
    fromMock.mockClear();
    uploadMock.mockReset();
    createSignedUrlMock.mockReset();
    removeMock.mockReset();
  });

  afterEach(() => {
    process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
  });

  it("upload usa o bucket crm-arquivos, repassa o contentType e devolve o path", async () => {
    uploadMock.mockResolvedValue({ error: null });

    const storage = await criarSupabaseStorage();
    const retorno = await storage.upload("itens/foto.png", PNG, "image/png");

    expect(fromMock).toHaveBeenCalledWith("crm-arquivos");
    expect(uploadMock).toHaveBeenCalledWith(
      "itens/foto.png",
      expect.any(Buffer),
      expect.objectContaining({ contentType: "image/png" })
    );
    expect(retorno).toBe("itens/foto.png");
  });

  it("upload lança erro claro quando o cliente Supabase retorna erro", async () => {
    uploadMock.mockResolvedValue({ error: { message: "bucket indisponível" } });

    const storage = await criarSupabaseStorage();

    await expect(storage.upload("itens/foto.png", PNG, "image/png")).rejects.toThrow(
      /Falha no upload.*bucket indisponível/
    );
  });

  describe("validação de conteúdo — o content-type vem do cliente e não vale nada sozinho", () => {
    it("recusa arquivo cujo conteúdo não bate com o tipo declarado, sem chamar o Supabase", async () => {
      uploadMock.mockResolvedValue({ error: null });
      const storage = await criarSupabaseStorage();

      // O caso que importa: HTML com <script> rotulado como imagem. Se
      // entrasse no bucket, bastaria abrir o link para executar script.
      await expect(
        storage.upload("itens/malicioso.png", HTML_COM_SCRIPT, "image/png")
      ).rejects.toThrow(/tipo de arquivo não permitido/);

      expect(uploadMock).not.toHaveBeenCalled();
    });

    it("recusa SVG mesmo sendo imagem — SVG é XML e executa script no navegador", async () => {
      const storage = await criarSupabaseStorage();
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

      await expect(storage.upload("itens/x.svg", svg, "image/svg+xml")).rejects.toThrow(
        /tipo de arquivo não permitido/
      );
    });

    it("não confunde WAV com WEBP — os dois começam com RIFF", async () => {
      const storage = await criarSupabaseStorage();

      await expect(
        storage.upload("itens/x.webp", WAV_QUE_FINGE_SER_WEBP, "image/webp")
      ).rejects.toThrow(/tipo de arquivo não permitido/);

      // E o WEBP de verdade passa.
      uploadMock.mockResolvedValue({ error: null });
      await expect(storage.upload("itens/ok.webp", WEBP, "image/webp")).resolves.toBe("itens/ok.webp");
    });

    it("aceita os formatos da allowlist com assinatura correta", async () => {
      uploadMock.mockResolvedValue({ error: null });
      const storage = await criarSupabaseStorage();

      await expect(storage.upload("a.png", PNG, "image/png")).resolves.toBe("a.png");
      await expect(storage.upload("a.jpg", JPEG, "image/jpeg")).resolves.toBe("a.jpg");
    });

    it("recusa arquivo acima do limite de tamanho, sem chamar o Supabase", async () => {
      const { storage, TAMANHO_MAXIMO_BYTES } = await carregarModulo();
      const gigante = Buffer.concat([PNG, Buffer.alloc(TAMANHO_MAXIMO_BYTES)]);

      await expect(storage.upload("itens/grande.png", gigante, "image/png")).rejects.toThrow(
        /acima do limite/
      );
      expect(uploadMock).not.toHaveBeenCalled();
    });
  });

  describe("validação de path — traversal escreve fora do prefixo pretendido", () => {
    const caminhosRuins = [
      "../fora/do/bucket.png",
      "itens/../../etc/senha.png",
      "/absoluto.png",
      "itens\\windows.png",
      "itens//vazio.png",
      "itens/./aqui.png",
      "",
    ];

    it.each(caminhosRuins)("recusa upload no caminho %j", async (ruim) => {
      const storage = await criarSupabaseStorage();
      await expect(storage.upload(ruim, PNG, "image/png")).rejects.toThrow(/caminho de arquivo inválido/);
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it("recusa também em urlAssinada e delete, não só no upload", async () => {
      const storage = await criarSupabaseStorage();

      await expect(storage.urlAssinada("../fora.png")).rejects.toThrow(/caminho de arquivo inválido/);
      await expect(storage.delete("../fora.png")).rejects.toThrow(/caminho de arquivo inválido/);

      expect(createSignedUrlMock).not.toHaveBeenCalled();
      expect(removeMock).not.toHaveBeenCalled();
    });
  });

  describe("urlAssinada", () => {
    it("pede uma URL assinada com a expiração padrão e devolve exatamente a do cliente", async () => {
      const { storage, EXPIRACAO_PADRAO_SEGUNDOS } = await carregarModulo();
      createSignedUrlMock.mockResolvedValue({
        data: { signedUrl: "https://exemplo.supabase.co/storage/v1/object/sign/crm-arquivos/x.png?token=abc" },
        error: null,
      });

      const url = await storage.urlAssinada("x.png");

      expect(fromMock).toHaveBeenCalledWith("crm-arquivos");
      expect(createSignedUrlMock).toHaveBeenCalledWith("x.png", EXPIRACAO_PADRAO_SEGUNDOS);
      expect(url).toBe(
        "https://exemplo.supabase.co/storage/v1/object/sign/crm-arquivos/x.png?token=abc"
      );
    });

    it("a expiração padrão é curta — link vazado não vira acesso permanente", async () => {
      const { EXPIRACAO_PADRAO_SEGUNDOS } = await carregarModulo();
      expect(EXPIRACAO_PADRAO_SEGUNDOS).toBeLessThanOrEqual(60 * 60);
    });

    it("lança erro claro quando o cliente falha", async () => {
      createSignedUrlMock.mockResolvedValue({ data: null, error: { message: "objeto não encontrado" } });
      const storage = await criarSupabaseStorage();

      await expect(storage.urlAssinada("x.png")).rejects.toThrow(/Falha ao gerar URL.*objeto não encontrado/);
    });
  });

  it("delete usa o bucket crm-arquivos e remove exatamente o path informado", async () => {
    removeMock.mockResolvedValue({ error: null });

    const storage = await criarSupabaseStorage();
    await storage.delete("itens/foto.png");

    expect(fromMock).toHaveBeenCalledWith("crm-arquivos");
    expect(removeMock).toHaveBeenCalledWith(["itens/foto.png"]);
  });

  it("delete lança erro claro quando o cliente Supabase retorna erro", async () => {
    removeMock.mockResolvedValue({ error: { message: "objeto não encontrado" } });

    const storage = await criarSupabaseStorage();

    await expect(storage.delete("itens/foto.png")).rejects.toThrow(/Falha ao remover.*objeto não encontrado/);
  });
});
