import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Storage } from "../../src/lib/storage";

class FakeStorage implements Storage {
  private arquivos = new Map<string, { file: Buffer; contentType: string }>();

  async upload(path: string, file: Buffer, contentType: string): Promise<string> {
    this.arquivos.set(path, { file, contentType });
    return `https://fake-storage.local/${path}`;
  }

  async delete(path: string): Promise<void> {
    this.arquivos.delete(path);
  }

  has(path: string): boolean {
    return this.arquivos.has(path);
  }
}

describe("Storage (contrato)", () => {
  it("upload retorna uma URL contendo o path", async () => {
    const fake = new FakeStorage();
    const url = await fake.upload("itens/foto.webp", Buffer.from("dados"), "image/webp");
    expect(url).toContain("itens/foto.webp");
  });

  it("delete remove o arquivo previamente enviado", async () => {
    const fake = new FakeStorage();
    await fake.upload("itens/foto.webp", Buffer.from("dados"), "image/webp");
    await fake.delete("itens/foto.webp");
    expect(fake.has("itens/foto.webp")).toBe(false);
  });
});

// A suíte acima só exercita a lógica trivial do FakeStorage (nunca falha por
// construção). Esta suíte exercita a SupabaseStorage real, com o cliente
// @supabase/supabase-js mockado via vi.mock — sem rede, sem credenciais, sem
// bucket real — para garantir que uma regressão na implementação (bucket
// errado, contentType perdido, URL "na mão" em vez da resposta do cliente,
// erro engolido) derrube o teste.
const { createClientMock, fromMock, uploadMock, getPublicUrlMock, removeMock } = vi.hoisted(() => {
  const uploadMock = vi.fn();
  const getPublicUrlMock = vi.fn();
  const removeMock = vi.fn();
  const fromMock = vi.fn(() => ({
    upload: uploadMock,
    getPublicUrl: getPublicUrlMock,
    remove: removeMock,
  }));
  const createClientMock = vi.fn(() => ({
    storage: { from: fromMock },
  }));
  return { createClientMock, fromMock, uploadMock, getPublicUrlMock, removeMock };
});

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server", que o Next.js aplica no build de Server Components. Fora
// desse pipeline (aqui, sob Vitest) ele sempre lança, independente de quem
// importa — por isso é mockado apenas neste arquivo de teste. Isso não
// enfraquece a guarda em produção: o import real em src/lib/storage.ts
// continua intacto e só é substituído dentro deste processo de teste.
vi.mock("server-only", () => ({}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function criarSupabaseStorage(): Promise<Storage> {
  vi.resetModules();
  process.env.SUPABASE_URL = "https://exemplo.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-service-role-de-teste";
  const mod = await import("../../src/lib/storage");
  return mod.storage;
}

describe("SupabaseStorage (implementação real, cliente Supabase mockado)", () => {
  beforeEach(() => {
    createClientMock.mockClear();
    fromMock.mockClear();
    uploadMock.mockReset();
    getPublicUrlMock.mockReset();
    removeMock.mockReset();
  });

  afterEach(() => {
    process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
  });

  it("upload usa o bucket crm-arquivos, repassa o contentType e retorna a publicUrl da resposta do cliente", async () => {
    uploadMock.mockResolvedValue({ error: null });
    getPublicUrlMock.mockReturnValue({
      data: { publicUrl: "https://exemplo.supabase.co/storage/v1/object/public/crm-arquivos/itens/foto.webp" },
    });

    const storage = await criarSupabaseStorage();
    const url = await storage.upload("itens/foto.webp", Buffer.from("dados"), "image/webp");

    expect(fromMock).toHaveBeenCalledWith("crm-arquivos");
    expect(uploadMock).toHaveBeenCalledWith(
      "itens/foto.webp",
      expect.any(Buffer),
      expect.objectContaining({ contentType: "image/webp" })
    );
    // A URL retornada precisa ser exatamente a publicUrl que o cliente
    // devolveu — não uma string montada à mão a partir do path.
    expect(url).toBe("https://exemplo.supabase.co/storage/v1/object/public/crm-arquivos/itens/foto.webp");
  });

  it("upload lança erro claro quando o cliente Supabase retorna erro", async () => {
    uploadMock.mockResolvedValue({ error: { message: "bucket indisponível" } });

    const storage = await criarSupabaseStorage();

    await expect(
      storage.upload("itens/foto.webp", Buffer.from("dados"), "image/webp")
    ).rejects.toThrow(/Falha no upload.*bucket indisponível/);
  });

  it("delete usa o bucket crm-arquivos e remove exatamente o path informado", async () => {
    removeMock.mockResolvedValue({ error: null });

    const storage = await criarSupabaseStorage();
    await storage.delete("itens/foto.webp");

    expect(fromMock).toHaveBeenCalledWith("crm-arquivos");
    expect(removeMock).toHaveBeenCalledWith(["itens/foto.webp"]);
  });

  it("delete lança erro claro quando o cliente Supabase retorna erro", async () => {
    removeMock.mockResolvedValue({ error: { message: "objeto não encontrado" } });

    const storage = await criarSupabaseStorage();

    await expect(storage.delete("itens/foto.webp")).rejects.toThrow(/Falha ao remover.*objeto não encontrado/);
  });
});
