import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export const MODEL = "claude-opus-5-5";

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
