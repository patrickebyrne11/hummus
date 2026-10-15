import { spawn } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-5-5";

/**
 * Which backend answers structuredCall():
 *  - "api": the Anthropic API with ANTHROPIC_API_KEY (needs API credits).
 *  - "claude-code": the locally installed Claude Code CLI in headless mode, signed in
 *    with the owner's Claude subscription. For running on your own machine only; a
 *    deployed app serving other people needs an API key.
 * CLAUDE_BACKEND overrides; otherwise use the API when a key is set, else Claude Code.
 */
function backend(): "api" | "claude-code" {
  const b = process.env.CLAUDE_BACKEND;
  if (b === "api" || b === "claude-code") return b;
  return process.env.ANTHROPIC_API_KEY ? "api" : "claude-code";
}

let client: Anthropic | null = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new UserFacingError(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server.",
      500,
    );
  }
  client ??= new Anthropic();
  return client;
}

export class UserFacingError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** One structured-output call. Throws UserFacingError on refusal or unparseable output. */
export async function structuredCall<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  user: string;
  effort: "low" | "medium" | "high";
}): Promise<z.infer<S>> {
  if (backend() === "claude-code") return claudeCodeCall(opts);
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.user }],
  });

  if (response.stop_reason === "refusal") {
    throw new UserFacingError("The model declined this request.", 422);
  }
  if (response.stop_reason === "max_tokens") {
    throw new UserFacingError("The list is too long to process in one go. Try splitting it.", 413);
  }
  if (!response.parsed_output) {
    throw new UserFacingError("The model returned output that didn't match the expected format.", 502);
  }
  return response.parsed_output as z.infer<S>;
}

/** structuredCall via `claude -p` (Claude Code headless), validated against the same zod schema. */
async function claudeCodeCall<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  user: string;
  effort: "low" | "medium" | "high";
}): Promise<z.infer<S>> {
  // Claude Code's validator rejects zod's 2020-12 "$schema" tag; the schema body is fine without it.
  const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(opts.schema) as Record<string, unknown>;
  void _dialect;
  const args = [
    "-p",
    "--output-format", "json",
    "--model", MODEL,
    "--effort", opts.effort,
    "--json-schema", JSON.stringify(jsonSchema),
    "--system-prompt", opts.system,
    // A pure text-in, JSON-out call: no tools, MCP servers, project settings or saved session.
    "--tools", "",
    "--strict-mcp-config",
    "--setting-sources", "",
    "--no-session-persistence",
  ];
  // Drop the API key so Claude Code uses the subscription login, and drop the markers
  // that make it think it is nested inside another Claude Code session.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_CODE_BIN ?? "claude", args, { env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 180_000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) =>
      reject(new UserFacingError(`Couldn't start Claude Code (${e.message}). Is the \`claude\` CLI installed and logged in?`, 500)),
    );
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 || stdout.trim()) resolve(stdout);
      else reject(new UserFacingError(`Claude Code exited with code ${code}: ${stderr.slice(0, 300)}`, 502));
    });
    child.stdin.end(opts.user);
  });

  let result: { is_error?: boolean; result?: string; structured_output?: unknown; stop_reason?: string };
  try {
    result = JSON.parse(out);
  } catch {
    throw new UserFacingError("Claude Code returned output that wasn't JSON.", 502);
  }
  if (result.is_error) {
    throw new UserFacingError(`Claude Code error: ${String(result.result ?? "unknown").slice(0, 300)}`, 502);
  }
  if (result.stop_reason === "refusal") {
    throw new UserFacingError("The model declined this request.", 422);
  }
  const parsed = opts.schema.safeParse(result.structured_output);
  if (!parsed.success) {
    throw new UserFacingError("The model returned output that didn't match the expected format.", 502);
  }
  return parsed.data as z.infer<S>;
}

export function errorResponse(err: unknown) {
  if (err instanceof UserFacingError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return Response.json({ error: "Anthropic API key was rejected." }, { status: 500 });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return Response.json({ error: "Rate limited by the Anthropic API — try again shortly." }, { status: 429 });
  }
  if (err instanceof Anthropic.APIError) {
    return Response.json({ error: `Anthropic API error ${err.status}: ${err.message}` }, { status: 502 });
  }
  console.error(err);
  return Response.json({ error: "Unexpected server error." }, { status: 500 });
}
