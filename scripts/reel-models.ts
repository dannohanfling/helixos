/**
 * Reel to Post, PR B (H-1948, plan H-1953): fills HelixOS's own model store, once. Run by Danno (it uses the public Blob
 * store's token, which stays his):
 *
 *   npx tsx scripts/reel-models.ts download ./reel-store      # the three Whisper models and the runtime, into a folder
 *   BLOB_READ_WRITE_TOKEN=… npx tsx scripts/reel-models.ts upload ./reel-store
 *
 * Then set REEL_MODELS_URL in Vercel to the address it prints, and redeploy. Members' browsers read the listening model from
 * there, never from Hugging Face or a CDN; the browser keeps it after the first time. Open model weights only: nothing about
 * a member goes into this store.
 *
 * The store holds manifest.json (each tier's model and its real download size, which the page shows before the first run),
 * runtime/ (Transformers.js and its WebAssembly) and models/<model>/ (config files and the 8-bit ONNX weights).
 */
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const RUNTIME_PACKAGE = "@huggingface/transformers@3.8.1";
const RUNTIME_FILES = ["transformers.min.js", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"];
const TIERS = { small: "onnx-community/whisper-small.en", base: "onnx-community/whisper-base.en", tiny: "onnx-community/whisper-tiny.en" } as const;
const MODEL_FILES = ["config.json", "generation_config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json", "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"];
const OPTIONAL_FILES = ["special_tokens_map.json", "added_tokens.json", "normalizer.json", "vocab.json", "merges.txt"];
const PREFIX = "reel-models/v1/";

const TYPES: Record<string, string> = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".onnx": "application/octet-stream", ".txt": "text/plain" };
const typeOf = (p: string) => TYPES[p.slice(p.lastIndexOf("."))] ?? "application/octet-stream";

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

async function fetchTo(url: string, to: string, required: boolean): Promise<boolean> {
  const res = await fetch(url);
  if (!res.ok) {
    if (required) throw new Error(`${url} answered ${res.status}`);
    return false;
  }
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
  return true;
}

async function download(dir: string) {
  mkdirSync(join(dir, "runtime"), { recursive: true });
  // The runtime from npm, without running any of its scripts.
  const packDir = join(dir, ".pack");
  mkdirSync(packDir, { recursive: true });
  const tgz = execFileSync("npm", ["pack", "--ignore-scripts", RUNTIME_PACKAGE], { cwd: packDir }).toString().trim().split("\n").pop()!;
  execFileSync("tar", ["-xzf", tgz, "-C", packDir], { cwd: packDir });
  for (const f of RUNTIME_FILES) execFileSync("cp", [join(packDir, "package", "dist", f), join(dir, "runtime", f)]);
  console.log(`runtime: ${RUNTIME_FILES.length} files from ${RUNTIME_PACKAGE}`);
  const tiers: Record<string, { model: string; bytes: number }> = {};
  for (const [tier, model] of Object.entries(TIERS)) {
    let bytes = 0;
    for (const f of MODEL_FILES) {
      const to = join(dir, "models", model, f);
      await fetchTo(`https://huggingface.co/${model}/resolve/main/${f}`, to, true);
      bytes += statSync(to).size;
    }
    for (const f of OPTIONAL_FILES) {
      const to = join(dir, "models", model, f);
      if (await fetchTo(`https://huggingface.co/${model}/resolve/main/${f}`, to, false)) bytes += statSync(to).size;
    }
    tiers[tier] = { model, bytes };
    console.log(`${tier}: ${model}, ${(bytes / 1_000_000).toFixed(0)} MB`);
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ runtime: "runtime/", models: "models/", tiers }, null, 2));
  execFileSync("rm", ["-rf", packDir]);
  console.log(`Done. Next: BLOB_READ_WRITE_TOKEN=… npx tsx scripts/reel-models.ts upload ${dir}`);
}

async function upload(dir: string) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Set BLOB_READ_WRITE_TOKEN (the public store's token) for this one command.");
  if (!existsSync(join(dir, "manifest.json"))) throw new Error(`${dir} has no manifest.json: run the download step first.`);
  const { put } = await import("@vercel/blob");
  let base = "";
  // The manifest last: a page only offers listening once every file it names is there.
  const files = filesUnder(dir).filter((p) => !p.endsWith("manifest.json")).concat(join(dir, "manifest.json"));
  for (const p of files) {
    const key = PREFIX + relative(dir, p).split("\\").join("/");
    const size = statSync(p).size;
    const blob = await put(key, createReadStream(p), { access: "public", contentType: typeOf(p), addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 * 60 * 24 * 365, multipart: size > 50_000_000 });
    if (key === `${PREFIX}manifest.json`) base = blob.url.slice(0, blob.url.length - "manifest.json".length);
    console.log(`uploaded ${key} (${(size / 1_000_000).toFixed(1)} MB)`);
  }
  // The browser reads these from the app's own pages: the store must say any page may read them.
  const check = await fetch(`${base}manifest.json`, { headers: { origin: "https://example.org" } });
  const cors = check.headers.get("access-control-allow-origin");
  console.log(cors ? `The store lets pages read it (${cors}).` : "WARNING: the store sent no Access-Control-Allow-Origin header; browsers won't be able to read the models. Tell Architectus.");
  console.log(`\nSet REEL_MODELS_URL=${base} in Vercel (Production), then redeploy.`);
}

const [cmd, dir] = process.argv.slice(2);
if (!dir || (cmd !== "download" && cmd !== "upload")) {
  console.error("Usage: npx tsx scripts/reel-models.ts download <folder> | upload <folder>");
  process.exit(1);
}
(cmd === "download" ? download(dir) : upload(dir)).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
