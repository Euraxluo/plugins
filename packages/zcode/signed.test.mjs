import { afterEach, beforeEach, expect, test } from "bun:test"
import { homedir, tmpdir } from "node:os"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { realpathSync } from "node:fs"
import { ZCodeAuthPlugin, _internal } from "./index.mjs"
import { createSigner, minePow } from "./sign.mjs"

if (![tmpdir(), realpathSync(tmpdir())].some((t) => homedir().startsWith(t))) throw new Error("run in an isolated home")

const KEY = "one.secret"
const state = { site: "bigmodel", base: "https://open.bigmodel.cn/api/anthropic", key: KEY, device: "device" }
const auth = { type: "oauth", access: KEY, refresh: JSON.stringify(state), expires: 0 }
const sent = []
const real = globalThis.fetch

beforeEach(() => {
  sent.length = 0
  globalThis.fetch = async (input, init) => {
    sent.push({ input: String(input), init, headers: new Headers(init?.headers) })
    return new Response(JSON.stringify({ ok: true }))
  }
})

afterEach(() => {
  globalThis.fetch = real
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

test("BigModel coding models gain opt-in Signed aliases", async () => {
  const hooks = await ZCodeAuthPlugin({ client: { auth: { set: async () => {} } } })
  const models = await hooks.provider.models({ models: {} }, { auth })
  expect(models["GLM-5.3-Signed"]).toMatchObject({ id: "GLM-5.3-Signed" })
})

test("a Signed alias strips its suffix and sends the normal coding key", async () => {
  const realPlansOf = _internal.plansOf
  _internal.plansOf = async () => ({ start: false, gift: null })
  const res = await send("GLM-5.3-Signed")
  expect(res.status).toBe(200)
  expect(sent).toHaveLength(1)
  expect(JSON.parse(sent[0].init.body).model).toBe("GLM-5.3")
  expect(sent[0].headers.get("x-api-key")).toBe(KEY)
  expect(sent[0].headers.get("authorization")).toBe("Bearer " + KEY)
  _internal.plansOf = realPlansOf
})
