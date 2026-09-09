import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Every export from a "use server" module is a public RPC endpoint. Only actions belong there, and actions resolve the viewer themselves.
    files: ["src/lib/actions/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "ExportNamedDeclaration > FunctionDeclaration[id.name!=/Action$/]", message: "Only *Action functions may be exported from src/lib/actions. Put queries in src/lib/queries." },
        { selector: "ExportNamedDeclaration > VariableDeclaration", message: "Only *Action functions may be exported from src/lib/actions." },
        { selector: "ExportDefaultDeclaration", message: "Only named *Action functions may be exported from src/lib/actions." },
      ],
    },
  },
  {
    // Every model call goes through draft() in src/lib/ai.ts, which builds the system message itself (voice first, task second).
    // No feature may reach the SDKs directly and compose its own: that is how a pasted voice drifts.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/lib/ai.ts", "src/lib/openalex.ts", "src/lib/actions/evidence.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@anthropic-ai/sdk", message: "Call draft() in src/lib/ai.ts; it assembles the system message (Essence first, task second)." },
            { name: "openai", message: "Call draft() in src/lib/ai.ts; it assembles the system message (Essence first, task second)." },
            // OpenAlex takes Danno's one key as a query parameter: a browser call would hand it to every client. Server actions only.
            { name: "@/lib/openalex", message: "OpenAlex is server-side only (the key rides in the URL). Call it from src/lib/actions/evidence.ts." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/openalex.ts", "src/lib/actions/evidence.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: [{ name: "@anthropic-ai/sdk", message: "Call draft() in src/lib/ai.ts." }, { name: "openai", message: "Call draft() in src/lib/ai.ts." }] }],
    },
  },
  {
    files: ["src/lib/ai.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: [{ name: "@/lib/openalex", message: "OpenAlex is server-side only. Call it from src/lib/actions/evidence.ts." }] }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
