// Reel to Post, PR B (H-1948, plan H-1953): listens to a reel on the member's own device. The page decodes the reel's sound to
// 16 kHz mono and sends it here with the store's addresses; this worker loads the speech model (Whisper, through
// Transformers.js) from HelixOS's own model store, never from a third party, and writes the words chunk by chunk. Nothing
// here sends the sound anywhere: the store is only read from, and the browser keeps the model for next time.
//
// Messages in:  { type: "run", runtimeUrl, modelsUrl, model, device: "webgpu" | "wasm", options, audio: Float32Array, chunks: [start, end][] }
// Messages out: { type: "download", loaded, total } while the model arrives (first time only)
//               { type: "device", device } when the model is ready, on the device it runs on
//               { type: "chunk", done, total } after each chunk is written
//               { type: "done", text } | { type: "error", message }

let lib = null;
const pipes = new Map();

async function loadLib(runtimeUrl) {
  if (lib) return lib;
  lib = await import(/* webpackIgnore: true */ `${runtimeUrl}transformers.min.js`);
  const { env } = lib;
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  env.backends.onnx.wasm.wasmPaths = runtimeUrl;
  // One thread: running threaded needs cross-origin isolation, which would break the chat widget and the video embeds.
  env.backends.onnx.wasm.numThreads = 1;
  return lib;
}

async function pipeFor(msg, device) {
  const key = `${msg.modelsUrl}|${msg.model}|${device}`;
  if (pipes.has(key)) return pipes.get(key);
  const { env, pipeline } = await loadLib(msg.runtimeUrl);
  env.remoteHost = msg.modelsUrl;
  env.remotePathTemplate = "{model}/";
  const files = new Map();
  const p = await pipeline("automatic-speech-recognition", msg.model, {
    device,
    dtype: "q8",
    progress_callback: (e) => {
      if (e.status !== "progress" || !e.file) return;
      files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 0 });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      self.postMessage({ type: "download", loaded, total });
    },
  });
  pipes.set(key, p);
  return p;
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg || msg.type !== "run") return;
  try {
    let device = msg.device === "webgpu" ? "webgpu" : "wasm";
    let pipe;
    try {
      pipe = await pipeFor(msg, device);
    } catch (e) {
      if (device !== "webgpu") throw e;
      // WebGPU said yes but couldn't run the model: the plain path works everywhere.
      device = "wasm";
      pipe = await pipeFor(msg, device);
    }
    self.postMessage({ type: "device", device });
    const parts = [];
    for (let i = 0; i < msg.chunks.length; i++) {
      const [start, end] = msg.chunks[i];
      const out = await pipe(msg.audio.subarray(start, end), { ...(msg.options ?? {}), return_timestamps: false });
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text) ?? "";
      if (text.trim()) parts.push(text.trim());
      self.postMessage({ type: "chunk", done: i + 1, total: msg.chunks.length });
    }
    self.postMessage({ type: "done", text: parts.join(" ") });
  } catch (e) {
    self.postMessage({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
