// Hook rozwiązywania modułów dla testów: funkcje w api/ importują `./x.js`
// (konwencja NodeNext/Vercel), a na dysku leży `x.ts`. Node ze strip-types
// sam tego nie mapuje — tu podmieniamy brakujące .js na .ts.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, next) {
  if (specifier.endsWith(".js") && (specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
    const js = new URL(specifier, context.parentURL);
    if (!existsSync(fileURLToPath(js))) {
      const ts = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(ts))) return next(ts.href, context);
    }
  }
  return next(specifier, context);
}
