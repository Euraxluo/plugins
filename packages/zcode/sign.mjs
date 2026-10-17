// BigModel's zhipu-client-sign channel, ported from quota-hub glmsign.
// The BigModel Coding Plan uses it for every normal model request and keeps
// no credentials outside the in-memory signer bound to the current auth key.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign as cryptoSign,
} from "node:crypto"

const UPSTREAM = "https://open.bigmodel.cn"
const HANDSHAKE_PATH = "/api/paas/c1f3a7e2/v2/client"
const KDF_SALT = "WD_CLIENT_SIGN_KDF_SALT"
const APP_ID = "zcode"
const VERSION = "3.4.0"
const UA = "ZCode/" + VERSION
const POW_MAX = 5_000_000

function hkdf(secret, info, length) {
  const prk = createHmac("sha256", KDF_SALT).update(secret).digest()
  const out = []
  let t = Buffer.alloc(0)
  for (let i = 1; Buffer.concat(out).length < length; i++) {
    t = createHmac("sha256", prk).update(Buffer.concat([t, Buffer.from(info), Buffer.from([i])])).digest()
    out.push(t)
  }
  return Buffer.concat(out).subarray(0, length)
}

function gcmOpen(key, blob, aad) {
  if (!(blob.length > 12 + 16)) throw new Error("cipher is too short")
  const d = createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12))
  d.setAAD(Buffer.from(aad))
  d.setAuthTag(blob.subarray(blob.length - 16))
  return Buffer.concat([d.update(blob.subarray(12, blob.length - 16)), d.final()])
}

function gcmSeal(key, plain, aad) {
  const nonce = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", key, nonce)
  c.setAAD(Buffer.from(aad))
  return Buffer.concat([nonce, c.update(plain), c.final(), c.getAuthTag()])
}

export function splitAPIKey(apiKey) {
  const id = String(apiKey ?? "")
  const at = id.indexOf(".")
  if (at <= 0 || at === id.length - 1) throw new Error("BigModel's sign key must be <id>.<secret>")
  return [id.slice(0, at), id.slice(at + 1)]
}

export function minePow(keyID, sessionID, ts) {
  const challenge = createHash("sha256")
    .update(`${keyID}\n${APP_ID}\n${sessionID}\n${ts}`)
    .digest("hex")
    .slice(0, 32)
  for (let cand = 0; cand < POW_MAX; cand++) {
    if (createHash("sha256").update(`${challenge}\n${cand}`).digest()[0] === 0) return String(cand)
  }
  return ""
}

function privateKeyFromDER(der) {
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" })
  if (key.asymmetricKeyType !== "ed25519") throw new Error("BigModel's sign key is not Ed25519")
  return key
}

export function createSigner({ apiKey, fetchImpl = globalThis.fetch } = {}) {
  let keyID, secret, key, sealedDER, inflight
  if (apiKey !== undefined) [keyID, secret] = splitAPIKey(apiKey)

  async function handshake() {
    const ts = String(Date.now())
    const nonce = randomBytes(16).toString("hex")
    const mac = createHmac("sha256", hkdf(secret, "get_sign_key_hmac", 32))
      .update(`get_sign_key\n${keyID}\n${ts}\n${nonce}`)
      .digest("base64")
    const res = await fetchImpl(UPSTREAM + HANDSHAKE_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${keyID}.${secret}`,
        "user-agent": UA,
      },
      body: JSON.stringify({ apiKey: `${keyID}.${secret}`, ts, nonce, sig: mac }),
      signal: AbortSignal.timeout(30_000),
    })
    const env = await res.json().catch(() => ({}))
    const cipher = env?.data?.privateCipher
    if (!res.ok || env?.code !== 200 || !cipher) {
      throw new Error(`BigModel sign handshake: HTTP ${res.status} code ${env?.code ?? "none"}`)
    }
    const plain = gcmOpen(hkdf(secret, "ed25519_priv", 32), Buffer.from(cipher, "base64"), keyID)
    const der = Buffer.from(plain.toString("utf8").trim(), "base64")
    key = privateKeyFromDER(der)
    sealedDER = gcmSeal(hkdf(secret, "local-key-cache", 32), der, keyID)
  }

  async function ensure() {
    if (key) return
    if (sealedDER) {
      key = privateKeyFromDER(gcmOpen(hkdf(secret, "local-key-cache", 32), sealedDER, keyID))
      return
    }
    inflight ??= handshake().finally(() => { inflight = undefined })
    await inflight
  }

  function reset() {
    key = undefined
    sealedDER = undefined
  }

  async function headers(sessionID, model) {
    await ensure()
    const ts = String(Date.now())
    const random = randomBytes(32)
    const nonce = random.subarray(0, 16).toString("hex")
    const requestID = random.subarray(16).toString("hex")
    const payload = `${keyID}\n${ts}\n${VERSION}\n${sessionID}\n${nonce}`
    const signature = cryptoSign(null, Buffer.from(payload), key).toString("base64")
    return {
      "X-Session-Id": sessionID,
      "X-Client-Ts": ts,
      "X-Client-Version": VERSION,
      "X-Client-Nonce": nonce,
      "X-Client-Sig": signature,
      "X-App-Id": APP_ID,
      "X-Client-Pow": minePow(keyID, sessionID, ts),
      "X-Product": APP_ID,
      "User-Agent": UA,
      "X-Client-Type": "pc",
      "X-Request-Id": requestID,
      "X-Request-Model": model,
    }
  }

  return { headers, reset, ensure, bind(nextKey) { [keyID, secret] = splitAPIKey(nextKey); reset() } }
}
