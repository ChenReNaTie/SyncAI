import { access } from "node:fs/promises";

const sharedEntry = new URL("../packages/shared/src/index.ts", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@syncai/shared") {
    return {
      shortCircuit: true,
      url: sharedEntry,
    };
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    if (specifier.endsWith(".js")) {
      const tsUrl = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);

      try {
        await access(tsUrl);
        return {
          shortCircuit: true,
          url: tsUrl.href,
        };
      } catch {
        // Fall through to Node resolution when no matching TS source exists.
      }
    }
  }

  return nextResolve(specifier, context);
}
