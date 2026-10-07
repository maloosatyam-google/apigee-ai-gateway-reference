# Demo Script — Apigee AI Gateway

A presenter's talk track for the live demo UI.

Everything in this app is real: every prompt goes through a deployed Apigee proxy to a real
model on Vertex AI, and every number in the telemetry panel came back from that call. There
are no mocked responses. Say that out loud early — it is the single most credible thing
about the demo, and people assume the opposite.

---

## 0. Before you present

| Check | Why |
| --- | --- |
| Open the UI and send one throwaway prompt | Cold-start on the first call makes the gateway look slow. Warm it up before anyone is watching. |
| Confirm the environment badge in the footer | It reads `PROD` or `DEV`. Demo from **prod**. Dev is for testing changes. |
| Persona is **Admin** | Non-admin personas hide the Admin Console tab and are blocked from some models — correct behaviour, but not what you want mid-flow. |
| Hit **Reset** | Clears the transcript so the first "what changed" hint is clean. |
| Demo data is fresh | **Guide me** resets the Customer Service demo data (orders, refunds, cases) when it starts. Presenting without the tour? Press **Reset Demo Data** on the MCP tab first, or earlier runs will have changed ORD-1042's refundable balance and the case list. |
| Industry is set | Pick the customer's theme, or set the industry on the Apigee theme (e.g. **Education**). With a pack, the MCP tab and Agent Showcase use that industry's tools, hero customer and $30 / $120 story, and show a **Tools: &lt;industry&gt;** badge. The pack's story, flows and prompts are in [industries/README.md](../industries/README.md) and [MAPPING.md](../industries/MAPPING.md). **Reset Demo Data** also resets the pack data. |
| Pace the Agent Showcase | Each run spends real tokens against your key's token quota (the governance being shown). Many runs back to back will hit 429 `LLMTokenQuotaViolation` on the governed side; leave a minute or two between runs unless you are showing the burst scenario. |
| Approvals story | In the refund scenario the governed agent is refused at $120, says the refund was **not** applied, and raises a ServiceNow **Approval Request** incident (its only ServiceNow tool), quoting the incident number. Every industry does this. |
| Customer header | Library themes show the customer's full logo (name included) and their site's header colour, with a thin stripe in the brand colour under the bar. Edit both in the theme panel under **Header**. The full logo needs a window at least 1280 px wide. |

> [!TIP]
> Two ways in: `?settings=open` lands on the configuration drawer, `?tour=open` starts the
> guided tour immediately. Both are usable as bookmarks or slide links.

---

## 1. The five-minute version: **Guide me**

Bottom-right, next to the settings cog. It walks 24 steps, switches tabs for you, and
**fires real gateway calls as it goes** — so the narration lands on live telemetry rather
than on a description of it. The order:

| Part | Steps | What it covers |
|---|---|---|
| Customer theme | 2–4 | Palette button → Theme Studio: pick a library customer, or **Request a theme** (name + website) and the theme agent builds logo, header colour, brand colours, font and industry. The industry sets personas, prompts and tool packs. |
| AI Gateway | 5–12 | Scenario chips, `/auto` routing (simple → coding), semantic cache seed → hit, history, Request Flow, settings. |
| MCP Gateway | 13–16 | Industry tool pack, per-persona `tools/list`, numbered presets (works 200 / limit 403 / blocked 401·429), trace + Request Flow. |
| Agent Showcase | 17–21 | Same question to both agents, ungoverned vs governed columns, over-the-limit request → ServiceNow approval ticket, scoreboard, Agent Analytics. |
| Admin | 22–23 | Analytics and Monetization (admin persona only). |

Theme Studio is a modal, so the tour points at the palette button rather than opening it;
close the studio to carry on with the tour.

Use it when:

- You are handing the laptop to someone else.
- You have five minutes, not thirty.
- You want the audience to self-serve after the meeting.

Controls: **Next** / **Back**, `Esc` to leave, and the tour is non-modal, so you can click
the thing it is pointing at while the step is still on screen. That is deliberate.

---

## 2. The full script

The chat pane is on the left, the **Gateway Telemetry** inspector on the right. The six
scenario chips sit under the prompt box and cycle through their steps as you click them. To
jump to a specific step, hover a chip for a moment (or click its ▾) and pick it from the list.
Replies render as Markdown: headings, lists, tables and highlighted code blocks with a Copy button.

### Scenario A — One endpoint, many models

> **Click:** `🧠 Model Routing` chip → sub-button **Simple**

**Point at:** the *Smart Routing* card, top-right.

The client posted to `/auto`. It never named a model. The TypeSafe AI JEV System One router classified the prompt
and the gateway picked the tier that matches.

> **Click:** the same chip's **Coding** sub-button.

**Point at:** the *Smart Routing* card — it turns purple whenever the router chose the
model — and the `Routed to <model>` badge under the target URL on the new reply.

Same URL, same credential, different vendor. The reply itself shows the switch without
anyone needing to read the panel.

**The line:** *"The category-to-model map is a custom attribute on the API Product. Swapping
in a cheaper model for one category is a config change, not a deployment."*

> [!NOTE]
> The router chain lives in the proxy's `AutoRoutingFlow`, so it only executes for `/auto`
> requests. A direct call to `/models/<name>` skips it entirely and pays nothing for it.

---

### Scenario B — Semantic cache

> **Click:** `⚡ Semantic Cache` chip → **Seed (Miss)**

**Point at:** *Latency* and the cost on the *Smart Routing* card. This is the real price of
the call: the cache demo runs on **Claude Opus**, the most expensive model in the catalogue,
so the seed takes ~14 s and costs ~$0.08.

> **Click:** the same chip → **Instant Hit ($0)**

Read the prompts aloud, side by side. They are **differently worded questions with the same
meaning** — not a repeat. The cache matched on embedding similarity, not on string equality.

**Point at:** the *Semantic Cache* card. It turns green on a hit: `Vector Cache Hit`,
`$0 Token Cost`. Then the *Latency* figure above it, against what the seed call cost.

> [!TIP]
> If the vector index is still warm from an earlier rehearsal, **Seed (Miss)** will itself
> come back as a hit, so both cards are green and the latency gap is small. The *Semantic
> Cache* card is still true either way. Or hit **Reset** and use a prompt of your own to
> get a genuine cold miss.

**The line:** *"Exact-match caching never fires in production, because humans never ask the
same question twice the same way."*

> [!IMPORTANT]
> On a cache hit the panel says **"Served from cache"** and credits *no* model. That is not
> a gap — the cache is keyed on the prompt alone and the router never runs, so the gateway
> genuinely cannot attribute a model. Claiming one would be a lie in a telemetry panel.

---

### Scenario C — Access control

> **Click:** `🚫 Access Control` chip → **Missing Auth**, then → **Restricted Model**

Two different 401s from two different causes: no caller identity at all, and a valid
Enterprise key calling a model its API Product does not entitle it to.

**The line:** *"Model entitlement is an API Product attribute. The same key that works for
Flash is rejected for Opus, and the application never had to be changed."*

---

### Scenario D — Model Armor

> **Click:** `🛡️ Model Armor` chip → **Destructive**, **Jailbreak**, **PII Exfil**

Three prompts that never reach the model. The *Prompt Sanitization* card flips to **Blocked (400)**.

**The line:** *"This is enforced at the gateway, so it applies to every model behind it —
including the one a team stands up next quarter without telling you."*

---

### Scenario E — Tokenomics and quota

> **Click:** `⚡ Tokenomics` chip four times, within one minute → **Within Limit (1/4)** →
> **Nearing Threshold (2/4)** → **Quota Used Up (3/4)** → **Limit Exceeded (4/4)**

Claude Haiku is capped at 300 tokens a minute and each call costs ~120. Call 1 is ~40% and
passes quietly. Call 2 crosses 50%: still a 200, but the gateway sets
`x-gateway-token-quota-status: near-threshold` and an amber *Nearing token quota threshold*
banner appears at the top of the chat. Call 3 is still served but takes the window past 100%, so
the banner turns rose — *Token quota exhausted*. Call 4 returns a real **429** from the
token-rate quota, not a simulated one.

You can also jump straight to a sub-step (e.g. **4. Blocked (429)**): the UI first runs the
earlier steps that step depends on and says so in a grey note in the chat, so the 429 is still
real. If the window still holds calls from a previous run, it asks you to wait the remaining
seconds instead of showing a misleading result.

**Point at:** the banner (the gateway computed that percentage, not the UI), then the *Token*
card flipping to *Quota Exceeded*, and the *Wallet* card.

**The line:** *"Rate limits on LLM traffic have to be counted in tokens, not requests. One
request can cost a thousand times another."*

---

## 3. Proving it: the Request Flow

On **any** reply, click **Request Flow**.

This opens the exact ordered sequence of Apigee policies that specific call executed —
auth, Model Armor, routing, cache lookup, quota, cost accounting. Not a generic diagram;
that call's path.

This is usually the moment the architect in the room starts asking good questions. Leave
time for it.

---

## 4. Looking back at earlier calls

Every reply carrying telemetry is clickable, and each one also has an explicit
**Telemetry** button next to **Request Flow**.

- Click an earlier reply → the inspector loads **that** call, and shows an amber
  *Viewing an earlier call* banner with **Back to latest**.
- Flick between two replies to compare them directly: the *Smart Routing* and *Semantic
  Cache* cards light up on whichever call actually routed or hit the cache.

Use this when someone asks *"wait, go back — what did the first one cost?"* You do not have
to re-run it.

---

## 5. The surrounding tabs

| Tab | What to say | Notes |
| --- | --- | --- |
| **MCP Gateway** | Tool calls, not prompts, through the same gateway with the same identity and quota enforcement. | Deployed to **prod only**. |
| **Analytics & Cost** | Traffic, tokens and spend per model and per developer, from Apigee analytics. | |
| **Admin Console** | AI products, guardrails, rate plans, prepaid wallets, Ask Apigee. | **Admin persona only.** |
| **Architecture** (navbar) | The full blueprint, if someone wants the whole picture at once. | |

---

## 6. Things that will go wrong, and what to say

| Symptom | Cause | Recovery |
| --- | --- | --- |
| Cache **Instant Hit** returns a MISS | The cache TTL is short. It is 3 minutes: if the seed ran longer ago than that, it has lapsed. | Click **Instant Hit** again: if the seed is older than ~2 minutes, the UI re-runs **Seed (Miss)** first automatically. Say "the cache has a deliberately short TTL here so the demo does not go stale". |
| First call of the session is slow | Cold start. | Warm it up before you present (see §0). |
| Admin Console tab is missing | You are not on the Admin persona. | Gateway Settings → persona → Admin. |
| A `/auto` prompt routes somewhere you did not expect | The router is a real classifier on a real prompt. It is allowed to disagree with you. | Lean in: *"that is a genuine classification, not a lookup table — and if you disagree with it, you change the product attribute, not the code."* |

---

## 7. What the telemetry cards mean

| Card | Reads |
| --- | --- |
| **Smart Routing** | Which model actually served the call, its provider, cost tier, the router's intent label, and the USD cost. Says *Served from cache* when no model ran. |
| **Token** | Prompt / output / total tokens, or the quota rejection. |
| **Latency** | Round-trip through the gateway, including the router when `/auto` was used. |
| **Semantic Cache** | Whether `use-cache` was sent, and whether it hit. |
| **Prompt Sanitization** | Clean, or the specific block reason. |
| **Wallet** | Prepaid balance before and after this call. |

---

## Appendix — running it yourself

Local UI against the dev gateway:

```bash
cd ui && npm install
PORT=3000 DEFAULT_ENV=dev node server.js
```

Offline tests (`npm test`) never touch a gateway. Live tests run against **prod only** and
only when invoked explicitly — dev is a shared sandbox that users change directly, so it is
never a test target. The live suite spends prod token quota and budget and seeds the prod
semantic cache, so do not run it right before someone else demos:

```bash
npm run test:live        # PROD only (sets TEST_ALLOW_PROD=1; dev is never a test target)
npm run test:live:prod   # alias of test:live
```
