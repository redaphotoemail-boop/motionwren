/* Sand AI (Magi 2): the one engine that is not on Replicate. It gives no callback, only polling, so the minute heartbeat
   (which already checks every scene) does the waiting. Its ids look like "sand:<id>" so they never clash with Replicate's.
   Server only; the key (SAND_API_KEY) is a secret the owner adds. */
import { ProviderError, classify } from "./provider";

export const SAND_BASE = "https://api.sand.ai";
export const isSandId = (id: string) => id.startsWith("sand:");
export const isSandEndpoint = (endpoint: string) => endpoint.startsWith(SAND_BASE);
const base = () => (process.env.SAND_API_BASE || SAND_BASE).replace(/\/$/, ""); // local tests point this at a mock

function key() {
  const value = process.env.SAND_API_KEY;
  if (!value) throw new ProviderError("rejected", "Magi 2 needs the Sand AI key (SAND_API_KEY) to be added first.");
  return value;
}

/* Creates one generation from the same input shape the other engines get. Creation is not idempotent at Sand AI, so a failed
   request is never retried here: the scene queue decides. */
export async function sandCreate(input: Record<string, unknown>): Promise<string> {
  const bearer = key();
  const text = String(input.prompt || "").trim();
  const image = String(input.image || "");
  const ratio = String(input.aspect_ratio || "16:9");
  const body = {
    model: "magi-2",
    parts: [{ type: "text", text }, ...(image ? [{ type: "reference_image", image: { url: image } }] : [])],
    duration: Math.max(1, Math.round(Number(input.duration) || 5)),
    aspectRatio: ratio,
    resolution: "1080p",
    generateAudio: false, // customer films are silent; Sand AI's default is sound on
    ...(Number.isInteger(input.seed) ? { seed: input.seed } : {}),
  };
  let response: Response;
  try {
    response = await fetch(`${base()}/v2/generations`, { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch (error) {
    throw new ProviderError("transient", `The video engine could not be reached${error instanceof Error && error.message ? ` (${error.message.slice(0, 120)})` : ""}.`);
  }
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (response.ok && data.id !== undefined && data.id !== null) return `sand:${String(data.id)}`;
  const detail = String((data.error as { message?: unknown } | undefined)?.message || data.message || data.error || data.code || "");
  throw classify(response.status, detail, response);
}

/* Reads one generation and answers in Replicate's shape ({ status, output, error }) so the rest of production needs no changes. */
export async function sandPrediction(id: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${base()}/v2/generations/${encodeURIComponent(id.slice(5))}`, { headers: { Authorization: `Bearer ${key()}`, Accept: "application/json" } });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String((data.error as { message?: unknown } | undefined)?.message || data.message || "Unable to retrieve a generation job."));
  const status = String(data.status || "").toLowerCase();
  if (status === "succeeded") return { status: "succeeded", output: (data.output as { videoUrl?: unknown } | undefined)?.videoUrl || null };
  if (status === "failed" || status === "canceled" || status === "cancelled") {
    const error = data.error;
    return { status: status === "failed" ? "failed" : "canceled", error: typeof error === "string" ? error : String((error as { message?: unknown } | undefined)?.message || "The video engine could not make this scene.") };
  }
  return { status: "processing" };
}
