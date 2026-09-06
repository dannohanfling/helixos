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
