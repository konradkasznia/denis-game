// Autoryzacja publikacji z edytora beatmap (nagłówek x-editor-key = EDITOR_PASSWORD).
//
// Limit liczy NIEUDANE próby per IP i jest sprawdzany PRZED porównaniem hasła
// (wcześniej limit stał dopiero po sprawdzeniu klucza, więc zgadywanie hasła
// było nielimitowane). Ten sam klucz licznika używa middleware.ts dla /editor.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clientIp, failuresExceeded, recordFailure } from "./ratelimit.js";
import { json, safeEqual } from "./util.js";

export const EDITOR_FAIL_MAX = 10;
export const EDITOR_FAIL_WINDOW_SEC = 15 * 60;

/** true = autoryzowany; false = odpowiedź z błędem już wysłana. */
export async function requireEditor(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  const need = process.env.EDITOR_PASSWORD || "";
  if (!need) {
    // fail-closed WSZĘDZIE poza lokalnym devem (także preview) — inaczej na
    // preview-deploymencie każdy publikuje bez hasła do wspólnej bazy
    if (process.env.VERCEL_ENV !== "development") {
      json(res, 503, { error: "Publikacja wyłączona (brak konfiguracji hasła)." });
      return false;
    }
    return true;
  }
  const failKey = `editor-fail:${clientIp(req)}`;
  if (await failuresExceeded(failKey, EDITOR_FAIL_MAX, EDITOR_FAIL_WINDOW_SEC)) {
    json(res, 429, { error: "Zbyt wiele błędnych haseł. Spróbuj za 15 minut." });
    return false;
  }
  const key = String(req.headers["x-editor-key"] || "");
  if (!safeEqual(key, need)) {
    await recordFailure(failKey);
    json(res, 401, { error: "Złe hasło publikacji." });
    return false;
  }
  return true;
}
