// The daily check-in through the billing meter, with WorkBuddy's own path
// and idempotent answer. Everything stays on a local fake.
import { test, expect, afterAll, beforeAll, afterEach } from "bun:test"
import { homedir, tmpdir } from "node:os"
import { realpathSync } from "node:fs"

let WorkBuddyAuthPlugin, WorkBuddyAIAuthPlugin, _internal
beforeAll(async () => {
  if (![tmpdir(), realpathSync(tmpdir())].some((t) => homedir().startsWith(t))) throw new Error("run with HOME=$(mktemp -d) bun test")
  ;({ WorkBuddyAuthPlugin, WorkBuddyAIAuthPlugin, _internal } = await import("./index.mjs"))
})
const offline = async () => { throw new Error("no network in tests") }
const real = globalThis.fetch
globalThis.fetch = offline
afterAll(() => (globalThis.fetch = real))
afterEach(() => {
  globalThis.fetch = offline
  _internal.renewing.clear()
  _internal.renewed.clear()
})

const later = () => Date.now() + 3600_000
const ok = (data = {}) => new Response(JSON.stringify({ code: 0, msg: "ok", data }))
const business = (code, msg) => new Response(JSON.stringify({ code, msg }))
const checkinOf = async (plugin, auth, client = {}) => (await plugin({ client })).auth.checkin(async () => auth)

function serve(routes) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url))
    calls.push({ url: u, init, headers: new Headers(init?.headers) })
    const r = routes[u.pathname]
    return r ? r(init) : new Response("", { status: 404 })
  }
  return calls
}

test("China claims through /v2 and signs as the billing account", async () => {
  const calls = serve({ "/v2/billing/meter/daily-checkin": () => ok() })
  const auth = { type: "oauth", access: "at", refresh: "r", expires: later(), uid: "u", domain: "" }
  expect(await checkinOf(WorkBuddyAuthPlugin, auth)).toEqual({ outcome: "claimed" })
  const c = calls[0]
  expect(c.init.method).toBe("POST")
  expect(c.init.body).toBe("{}")
  expect(c.headers.get("authorization")).toBe("Bearer at")
  expect(c.headers.get("x-user-id")).toBe("u")
  expect(c.headers.get("user-agent")).toBe("WorkBuddy/5.5.6")
})

test("an already-claimed day is done", async () => {
  serve({ "/v2/billing/meter/daily-checkin": () => business(14001, "今日已签到") })
  const auth = { type: "oauth", access: "at", refresh: "r", expires: later(), uid: "u", domain: "" }
  expect(await checkinOf(WorkBuddyAuthPlugin, auth)).toEqual({ outcome: "done" })
})

test("WorkBuddy AI falls back from the meter without /v2 on 404", async () => {
  const calls = serve({ "/v2/billing/meter/daily-checkin": () => ok() })
  const auth = { type: "oauth", access: "at", refresh: "r", expires: later(), uid: "u", domain: "www.codebuddy.ai" }
  expect(await checkinOf(WorkBuddyAIAuthPlugin, auth)).toEqual({ outcome: "claimed" })
  expect(calls.map((c) => c.url.pathname)).toEqual(["/billing/meter/daily-checkin", "/v2/billing/meter/daily-checkin"])
})

test("a transient billing failure retries twice, then reports failure", async () => {
  let calls = 0
  serve({ "/v2/billing/meter/daily-checkin": () => { calls++; return business(10000, "API request failed with status code: 500") } })
  const auth = { type: "oauth", access: "at", refresh: "r", expires: later(), uid: "u", domain: "" }
  const out = await checkinOf(WorkBuddyAuthPlugin, auth)
  expect(out.outcome).toBe("failed")
  expect(calls).toBe(3)
}, 8000)

test("a token near its end is renewed before the claim", async () => {
  const sets = []
  const calls = serve({
    "/v2/plugin/auth/token/refresh": () => ok({ accessToken: "new", refreshToken: "r2", expiresIn: 3600 }),
    "/v2/billing/meter/daily-checkin": () => ok(),
  })
  const auth = { type: "oauth", access: "old", refresh: "r", expires: Date.now() + 60_000, uid: "u", domain: "" }
  expect(await checkinOf(WorkBuddyAuthPlugin, auth, { auth: { set: async (x) => sets.push(x) } })).toEqual({ outcome: "claimed" })
  expect(calls[0].url.pathname).toBe("/v2/plugin/auth/token/refresh")
  expect(calls[1].headers.get("authorization")).toBe("Bearer new")
  expect(sets).toHaveLength(1)
})
