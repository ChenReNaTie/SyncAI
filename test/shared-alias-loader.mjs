const sharedEntry = new URL("../packages/shared/src/index.ts", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@syncai/shared") {
    return {
      shortCircuit: true,
      url: sharedEntry,
    };
  }

  return nextResolve(specifier, context);
}
