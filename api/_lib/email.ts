// Wysyłka maili przez Resend (REST, bez SDK).
//
// Zmienne środowiskowe:
//   RESEND_API_KEY   klucz z https://resend.com/api-keys
//   MAIL_FROM        (opcjonalnie) nadawca; domyślnie "onboarding@resend.dev"
//   APP_URL          (opcjonalnie) bazowy adres aplikacji do budowy linku resetu
//
// TRYB TESTOWY (bez zweryfikowanej domeny): Resend dostarczy maila tylko na
// adres właściciela konta. Realnym użytkownikom mail nie dojdzie, dopóki nie
// zweryfikujemy własnej domeny i nie ustawimy MAIL_FROM na adres w tej domenie.

const ENDPOINT = "https://api.resend.com/emails";

export function appUrl(): string {
  return (process.env.APP_URL || "https://denis-game.vercel.app").replace(/\/+$/, "");
}

export async function sendMail(to: string, subject: string, html: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Brak RESEND_API_KEY w środowisku.");
  const from = process.env.MAIL_FROM || "Denis Impulsywni Live <onboarding@resend.dev>";
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`Resend ${r.status}: ${detail}`);
  }
}

export async function sendResetEmail(to: string, token: string) {
  const link = `${appUrl()}/reset.html?token=${encodeURIComponent(token)}`;
  const subject = "Reset hasła — Denis Impulsywni Live";
  const text =
    `Cześć!\n\nOtrzymaliśmy prośbę o zmianę hasła do Twojego konta w grze ` +
    `Denis Impulsywni Live.\n\nUstaw nowe hasło: ${link}\n\n` +
    `Link jest ważny 1 godzinę. Jeśli to nie Ty prosiłeś o zmianę hasła, ` +
    `zignoruj tę wiadomość — nic się nie zmieni.`;
  const html = `<!doctype html><html lang="pl"><body style="margin:0;background:#0b0b12;font-family:Arial,Helvetica,sans-serif;color:#f2f2f5;padding:32px">
  <div style="max-width:520px;margin:0 auto;background:#15151f;border-radius:16px;padding:28px">
    <h1 style="margin:0 0 12px;font-size:22px;color:#ffcf3f">Zmiana hasła</h1>
    <p style="line-height:1.55;margin:0 0 18px">Otrzymaliśmy prośbę o ustawienie nowego hasła do Twojego konta w grze <b>Denis Impulsywni Live</b>.</p>
    <p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#ffcf3f;color:#1a1a1a;text-decoration:none;font-weight:bold;padding:14px 24px;border-radius:12px">Ustaw nowe hasło</a></p>
    <p style="line-height:1.55;margin:0 0 8px;font-size:13px;color:#a9a9b8">Link jest ważny 1 godzinę. Jeśli to nie Ty prosiłeś o zmianę hasła, zignoruj tę wiadomość.</p>
    <p style="margin:16px 0 0;font-size:12px;color:#75758a;word-break:break-all">${link}</p>
  </div></body></html>`;
  await sendMail(to, subject, html, text);
}
