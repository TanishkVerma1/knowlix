import "server-only";
import { createHash } from "node:crypto";

/**
 * All environment access goes through here so a missing key degrades
 * gracefully (and visibly, via /api/health) instead of crashing.
 */
function str(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export const env = {
  databaseUrl: str("DATABASE_URL"),
  isProduction: process.env.NODE_ENV === "production",
  isVercel: Boolean(process.env.VERCEL),
  aiProviders: (str("AI_PROVIDERS") ?? "groq,gemini,ollama")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  groqKey: str("GROQ_API_KEY"),
  groqModel: str("GROQ_MODEL") ?? "openai/gpt-oss-120b",
  geminiKey: str("GEMINI_API_KEY"),
  geminiModel: str("GEMINI_MODEL") ?? "gemini-2.5-flash",
  ollamaUrl: str("OLLAMA_BASE_URL"),
  ollamaModel: str("OLLAMA_MODEL") ?? "qwen2.5:7b",
  /** Context window for the local model, in tokens. Bigger reads more passages but is slower. */
  ollamaContext: Number(str("OLLAMA_NUM_CTX") ?? 8192) || 8192,
  mockAi: str("MOCK_AI") === "1",
  contactEmail: str("CONTACT_EMAIL"),
  openAlexKey: str("OPENALEX_API_KEY"),
  semanticScholarKey: str("SEMANTIC_SCHOLAR_API_KEY"),
  googleBooksKey: str("GOOGLE_BOOKS_API_KEY"),
};

let cachedSecret: Uint8Array | null = null;

/** Secret for signing the workspace cookie. Falls back to a value derived from the DB URL, then a dev constant. */
export function sessionSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const explicit = str("SESSION_SECRET");
  const material = explicit ?? (env.databaseUrl ? `knowlix-session:${env.databaseUrl}` : "knowlix-dev-session-secret");
  cachedSecret = new Uint8Array(createHash("sha256").update(material).digest());
  return cachedSecret;
}

export function sessionSecretSource(): "explicit" | "derived" | "dev-default" {
  if (str("SESSION_SECRET")) return "explicit";
  return env.databaseUrl ? "derived" : "dev-default";
}

export function userAgent(): string {
  return env.contactEmail
    ? `Knowlix/1.0 (student research assistant; mailto:${env.contactEmail})`
    : "Knowlix/1.0 (student research assistant)";
}
