import "./nonet.mjs"
import { afterEach, expect, test } from "bun:test"
import { TraeCNAuthPlugin, TraeGlobalAuthPlugin } from "./index.mjs"
import { fakeTrae, json, signedIn } from "./fake.mjs"

let f
afterEach(() => f?.close())
const STATUS = "/trae/api/v2/ug/checkin_credits/status"
const CLAIM = "/trae/api/v2/ug/checkin_credits/claim"

async function checkin(plugin = TraeCNAuthPlugin, auth = signedIn(), client = {}) {
  const hooks = await plugin({ client })
  return hooks.auth.checkin(async () => auth)
}

test("a claimable day is claimed through Trae's own pages", async () => {
  f = fakeTrae()
  f.route("POST " + STATUS, () => json({ code: 0, enable: true, checked_in: false }))
  f.route("POST " + CLAIM, () => json({ code: 0, credits: 100 }))
  expect(await checkin()).toEqual({ outcome: "claimed", credit: 100 })
  expect(f.seen.map((r) => r.path)).toEqual([STATUS, CLAIM])
  for (const r of f.seen) {
    expect(r.json).toEqual({ req_source: 1 })
    expect(r.headers.get("authorization")).toBe("Cloud-IDE-JWT jwt-1")
  }
})

test("an already-checked day is done without claiming", async () => {
  f = fakeTrae()
  f.route("POST " + STATUS, () => json({ code: 0, enable: true, checked_in: true, credits: 100 }))
  expect(await checkin()).toEqual({ outcome: "done", credit: 100 })
  expect(f.seen.map((r) => r.path)).toEqual([STATUS])
})

test("a disabled day is inactive", async () => {
  f = fakeTrae()
  f.route("POST " + STATUS, () => json({ code: 0, enable: false }))
  expect(await checkin()).toEqual({ outcome: "inactive" })
  expect(f.seen.map((r) => r.path)).toEqual([STATUS])
})

test("the device's already-checked answer is done", async () => {
  f = fakeTrae()
  f.route("POST " + STATUS, () => json({ code: 0, enable: true, checked_in: false }))
  f.route("POST " + CLAIM, () => json({ code: 9095, message: "已签到", credits: 100 }))
  expect(await checkin()).toEqual({ outcome: "done", credit: 100 })
})

test("Trae's busy answer is failed without another device", async () => {
  f = fakeTrae()
  f.route("POST " + STATUS, () => json({ code: 0, enable: true, checked_in: false }))
  f.route("POST " + CLAIM, () => json({ code: 9074, message: "当前参与用户太多" }))
  const out = await checkin()
  expect(out.outcome).toBe("failed")
  expect(out.message).toContain("当前参与用户太多")
  expect(f.seen.map((r) => r.headers.get("x-device-id"))).toEqual(["1234567890123456789", "1234567890123456789"])
})

test("an expired sign-in is failed and marked", async () => {
  f = fakeTrae()
  f.route("POST " + STATUS, () => json({ code: 1001, message: "not able to authenticate you" }))
  const out = await checkin()
  expect(out).toMatchObject({ outcome: "failed", signIn: "expired" })
})

test("Trae Global has no check-in", async () => {
  expect(await checkin(TraeGlobalAuthPlugin)).toEqual({ outcome: "inactive", message: "Trae Global has no daily check-in" })
})
