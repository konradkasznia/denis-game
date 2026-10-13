// Sprzątanie certyfikatów deweloperskich po buildzie iOS w chmurze.
//
// Każdy build na świeżym runnerze GitHuba: xcodebuild archive z
// -allowProvisioningUpdates tworzy NOWY certyfikat "Apple Development" (klucz
// prywatny istnieje tylko na tym runnerze i znika razem z nim). Po kilkunastu
// buildach konto osiąga limit certyfikatów i archive pada z błędem
// "Your account has reached the maximum number of certificates".
//
// Ten skrypt (App Store Connect API, ten sam klucz co build):
//   node tools/asc-dev-certs.mjs snapshot before.json   # zapisz ID certyfikatów PRZED buildem
//   node tools/asc-dev-certs.mjs cleanup  before.json   # usuń deweloperskie, które POWSTAŁY w tym buildzie
// Usuwa wyłącznie certyfikaty DEWELOPERSKIE utworzone w trakcie tego biegu —
// dystrybucyjnych (wysyłka do App Store) i wcześniejszych nie dotyka.
// Unieważnienie certyfikatu deweloperskiego po archive niczego nie psuje:
// eksport do App Store podpisuje aplikację certyfikatem dystrybucyjnym.
//
// Zmienne: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (plik AuthKey_<ID>.p8).

import fs from "node:fs";
import crypto from "node:crypto";

const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH } = process.env;
const [, , cmd, file] = process.argv;
if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_PATH || !cmd || !file) {
  console.error("Użycie: ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=… node tools/asc-dev-certs.mjs snapshot|cleanup <plik.json>");
  process.exit(1);
}

const b64url = (b) => Buffer.from(b).toString("base64url");
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 600, aud: "appstoreconnect-v1" }));
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), {
    key: fs.readFileSync(ASC_KEY_PATH, "utf8"),
    dsaEncoding: "ieee-p1363",
  });
  return `${head}.${body}.${b64url(sig)}`;
}

async function api(path, method = "GET") {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok && res.status !== 204) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const DEV_TYPES = new Set(["DEVELOPMENT", "IOS_DEVELOPMENT"]);

async function listCerts() {
  const out = [];
  let next = "/v1/certificates?limit=200&fields[certificates]=certificateType,name,displayName,expirationDate";
  while (next) {
    const j = await api(next);
    for (const c of j.data) out.push({ id: c.id, type: c.attributes.certificateType, name: c.attributes.displayName || c.attributes.name });
    next = j.links?.next ? j.links.next.replace("https://api.appstoreconnect.apple.com", "") : null;
  }
  return out;
}

const certs = await listCerts();
if (cmd === "snapshot") {
  fs.writeFileSync(file, JSON.stringify(certs.map((c) => c.id)));
  const dev = certs.filter((c) => DEV_TYPES.has(c.type)).length;
  console.log(`Certyfikaty na koncie: ${certs.length} (deweloperskie: ${dev}).`);
} else if (cmd === "cleanup") {
  let before;
  try {
    before = new Set(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    console.log("Brak zapisanego stanu sprzed buildu — nic nie usuwam (bezpieczny wybór).");
    process.exit(0);
  }
  const created = certs.filter((c) => !before.has(c.id) && DEV_TYPES.has(c.type));
  for (const c of created) {
    await api(`/v1/certificates/${c.id}`, "DELETE");
    console.log(`Usunięto certyfikat deweloperski z tego buildu: ${c.name} (${c.id})`);
  }
  if (!created.length) console.log("Ten build nie utworzył nowego certyfikatu deweloperskiego.");
} else {
  console.error(`Nieznana komenda: ${cmd}`);
  process.exit(1);
}
