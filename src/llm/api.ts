// api.ts — Anthropic Messages API adapter (HTTP).
//
// This is the LLM path for **Windows / headless** deployments where the `claude` CLI
// is NOT present. Cowork employee machines run the GUI desktop app, not the Code CLI,
// so the `claude -p` subprocess path (runner.ts → runClaudeP) won't exist there. This
// adapter talks to the Messages API directly over HTTP and honours `ANTHROPIC_BASE_URL`
// so it also works against an internal corporate gateway.
//
// Auth resolution (first that is set wins):
//   ANTHROPIC_API_KEY            → sent as `x-api-key`
//   ANTHROPIC_AUTH_TOKEN         → sent as `Authorization: Bearer` (gateway/ccs style)
// Base URL: ANTHROPIC_BASE_URL or https://api.anthropic.com.

const DEFAULT_BASE = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-opus-4-8";

export interface ApiOpts {
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  system?: string;
}

export async function runApiMessage(prompt: string, opts?: ApiOpts): Promise<string> {
  const base = (process.env.ANTHROPIC_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey && !authToken) {
    throw new Error(
      "Anthropic API adapter needs ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN in the environment " +
        "(set it directly, or via a ccs profile)."
    );
  }
  const model = opts?.model ?? DEFAULT_MODEL;
  const maxTokens = opts?.maxTokens ?? 4096;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": API_VERSION,
  };
  if (apiKey) headers["x-api-key"] = apiKey;
  else if (authToken) headers["authorization"] = `Bearer ${authToken}`;

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  };
  if (opts?.system) body.system = opts.system;

  let res: Response;
  try {
    res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 120_000),
    });
  } catch (e) {
    throw new Error(`Anthropic API request failed: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status} ${res.statusText}: ${txt.slice(0, 300)}`);
  }
  const data: any = await res.json();
  const text = Array.isArray(data?.content)
    ? data.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("")
    : "";
  if (!text) throw new Error("Anthropic API returned no text content");
  return text;
}

// ── CLI smoke test ────────────────────────────────────────────────────────────
// Usage: echo "Say OK" | bun run src/llm/api.ts [--model M]
if (import.meta.main) {
  const args = process.argv.slice(2);
  let model: string | undefined;
  for (let i = 0; i < args.length; i++) if (args[i] === "--model") model = args[++i];
  const prompt = await new Response(Bun.stdin.stream()).text();
  console.log(await runApiMessage(prompt || "Say only: OK", { model, maxTokens: 64 }));
}
