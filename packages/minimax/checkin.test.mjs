// The daily check-in (每日签到): the panel's day statuses and the claim's
// answers, as the minimax-cloud endpoints answer them (quota-hub's
// minimax2api worked them out). Everything runs against the local fake.
import "./nonet.mjs"
import { afterEach, expect, test } from "bun:test"
import { MiniMaxCodeAuthPlugin } from "./index.mjs"
import { fakeMiniMax, json } from "./fake.mjs"

let f
afterEach(() => f?.close())

const STATUS = "/minimax-cloud/api/v1/signin/status"
const CLAIM = "/minimax-cloud/api/v1/signin/claim"
const auth = { type: "oauth", access: "tok", refresh: "r", expires: Date.now() + 3600_000, accountId: "a@example.com" }

const day = (over = {}) => ({ day_no: 1, points: 10, status: 2, is_today: true, ...over })

async function checkin() {
  const plugin = await MiniMaxCodeAuthPlugin({ client: { auth: { set: async () => {} } } })
  return plugin.auth.checkin(async () => auth)
}

test("a claimable day is claimed, its points and the streak reported", async () => {
  f = fakeMiniMax()
  f.route("GET " + STATUS, () => json({ base_resp: { status_code: 0 }, data: { days: [day({ day_no: 6, status: 3, is_today: false }), day({ day_no: 7 })] } }))
  f.route("POST " + CLAIM, (r) => {
    expect(r.headers.get("authorization")).toBe("Bearer tok")
    return json({ base_resp: { status_code: 0 }, data: { claim_result: 1, points: 20, day_no: 7 } })
  })
  expect(await checkin()).toEqual({ outcome: "claimed", credit: 20, streak: 2 })
})

test("a claimed day is done, the streak counting it", async () => {
  f = fakeMiniMax()
  f.route("GET " + STATUS, () => json({ base_resp: { status_code: 0 }, data: { days: [day({ status: 3, is_today: true })] } }))
  expect(await checkin()).toEqual({ outcome: "done", streak: 1 })
})

test("the claim saying already-today is done", async () => {
  f = fakeMiniMax()
  f.route("GET " + STATUS, () => json({ base_resp: { status_code: 0 }, data: { days: [day()] } }))
  f.route("POST " + CLAIM, () => json({ base_resp: { status_code: 0 }, data: { claim_result: 2, points: 10 } }))
  expect(await checkin()).toEqual({ outcome: "done", credit: 10, streak: 1 })
})

test("a day that hasn't started is inactive", async () => {
  f = fakeMiniMax()
  f.route("GET " + STATUS, () => json({ base_resp: { status_code: 0 }, data: { days: [day({ status: 1 })] } }))
  expect(await checkin()).toEqual({ outcome: "inactive" })
})

test("a day that isn't available is ineligible", async () => {
  f = fakeMiniMax()
  f.route("GET " + STATUS, () => json({ base_resp: { status_code: 0 }, data: { days: [day({ status: 4 })] } }))
  expect(await checkin()).toEqual({ outcome: "ineligible" })
})

test("a panel without a day is inactive", async () => {
  f = fakeMiniMax()
  f.route("GET " + STATUS, () => json({ base_resp: { status_code: 0 }, data: { days: [] } }))
  expect(await checkin()).toEqual({ outcome: "inactive" })
})

test("the panel's error is failed with its words", async () => {
  f = fakeMiniMax()
  f.route("GET " + STATUS, () => json({ base_resp: { status_code: 1004, status_msg: "login fail" } }))
  const out = await checkin()
  expect(out.outcome).toBe("failed")
  expect(out.message).toContain("login fail")
})

test("a turned-away token is failed and marked signed out", async () => {
  f = fakeMiniMax()
  f.route("GET " + STATUS, () => new Response("no", { status: 401 }))
  const out = await checkin()
  expect(out.outcome).toBe("failed")
  expect(out.signIn).toBe("expired")
})

test("an unknown claim_result is failed", async () => {
  f = fakeMiniMax()
  f.route("GET " + STATUS, () => json({ base_resp: { status_code: 0 }, data: { days: [day()] } }))
  f.route("POST " + CLAIM, () => json({ base_resp: { status_code: 0 }, data: { claim_result: 9 } }))
  const out = await checkin()
  expect(out.outcome).toBe("failed")
  expect(out.message).toContain("claim_result")
})

test("a not-signed-in account is failed without a request", async () => {
  f = fakeMiniMax()
  const plugin = await MiniMaxCodeAuthPlugin({ client: { auth: { set: async () => {} } } })
  const out = await plugin.auth.checkin(async () => ({ type: "api", key: "k" }))
  expect(out.outcome).toBe("failed")
  expect(out.message).toBe("not signed in")
  expect(f.seen.length).toBe(0)
})
