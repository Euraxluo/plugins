import { afterEach, beforeEach, expect, test } from "bun:test"
import { homedir, tmpdir } from "node:os"
import { realpathSync } from "node:fs"
import { ZCodeAuthPlugin, _internal } from "./index.mjs"
import { createSigner, minePow } from "./sign.mjs"
import { createCipheriv, createHmac } from "node:crypto"

if (![tmpdir(), realpathSync(tmpdir())].some((t) => homedir().startsWith(t))) throw new Error("run in an isolated home")

const KEY = "one.secret"
const state = { site: "bigmodel", base: "https://open.bigmodel.cn/api/anthropic", key: KEY, device: "device" }
const auth = { type: "oauth", access: KEY, refresh: JSON.stringify(state), expires: 0 }
const sent = []
const real = globalThis.fetch
const DER = Buffer.from("MC4CAQAwBQYDK2VwBCIEINaofm94EHDBFTX6XkGlMUU8F41qb2mXKe/DMwUJbxCh", "base64")

function sealedKey() {
  const secret = "secret"
  const prk = createHmac("sha256", "WD_CLIENT_SIGN_KDF_SALT").update(secret).digest()
  const key = createHmac("sha256", prk).update(Buffer.concat([Buffer.from("ed25519_priv"), Buffer.from([1])])).digest().subarray(0, 32)
  const nonce = Buffer.alloc(12)
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  cipher.setAAD(Buffer.from("one"))
  return Buffer.concat([nonce, cipher.update(Buffer.from(DER.toString("base64"))), cipher.final(), cipher.getAuthTag()]).toString("base64")
}

beforeEach(() => {
  sent.length = 0
  _internal.signedSigners.clear()
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === "/api/paas/c1f3a7e2/v2/client") {
      return new Response(JSON.stringify({ code: 200, data: { privateCipher: sealedKey() } }), { headers: { "content-type": "application/json" } })
    }
    sent.push({ input: String(input), init, headers: new Headers(init?.headers) })
    return new Response(JSON.stringify({ ok: true }))
  }
})

afterEach(() => {
  globalThis.fetch = real
  _internal.signedSigners.clear()
})

async function send(model) {
  const hooks = await ZCodeAuthPlugin({ client: { auth: { set: async () => {} } } })
  const opts = await hooks.auth.loader(async () => auth, { id: "zcode" })
  return opts.fetch("https://open.bigmodel.cn/api/anthropic/v1/messages", {
    method: "POST",
    body: JSON.stringify({ model, messages: [] }),
  })
}

test("PoW follows glmsign's first-byte rule", () => {
  const cand = minePow("key", "session", "123")
  expect(Number(cand)).toBeGreaterThanOrEqual(0)
})

test("a BigModel coding request is signed without changing its model", async () => {
  const realPlansOf = _internal.plansOf
  _internal.plansOf = async () => ({ start: false, gift: null })
  const res = await send("GLM-5.3")
  expect(res.status).toBe(200)
  expect(sent).toHaveLength(1)
  expect(JSON.parse(sent[0].init.body).model).toBe("GLM-5.3")
  expect(sent[0].headers.get("x-api-key")).toBe(KEY)
  expect(sent[0].headers.get("authorization")).toBe("Bearer " + KEY)
  expect(sent[0].headers.get("x-app-id")).toBe("zcode")
  expect(sent[0].headers.get("x-client-version")).toBe("3.4.0")
  expect(sent[0].headers.get("x-client-sig")).toBeTruthy()
  expect(sent[0].headers.get("x-client-pow")).toBeTruthy()
  _internal.plansOf = realPlansOf
})

test("a failed BigModel sign handshake never sends an unsigned coding request", async () => {
  const realPlansOf = _internal.plansOf
  _internal.plansOf = async () => ({ start: false, gift: null })
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === "/api/paas/c1f3a7e2/v2/client") return new Response(JSON.stringify({ code: 403 }), { status: 403 })
    sent.push({ input: String(input), init, headers: new Headers(init?.headers) })
    return new Response(JSON.stringify({ ok: true }))
  }
  await expect(send("GLM-5.3")).rejects.toThrow("BigModel sign handshake")
  expect(sent).toHaveLength(0)
  _internal.plansOf = realPlansOf
})
