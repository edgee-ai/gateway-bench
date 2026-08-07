# AI Gateway TTFT Benchmark — 5–6 August 2026

**16,344 measurements · 6 gateways · 1,173 test runs · 28 countries · 6 continents · 2 models**

This report compares the time-to-first-token (TTFT) of six AI gateways, measured from
43 Google Cloud regions. It is published by Edgee, which is one of the gateways under test.
The methodology, the raw queries and the cases where Edgee ranks behind competitors are all
included, so that any claim here can be independently checked or contested.

**Scope.** The comparison covers the most widely deployed and most capable AI gateways on the
market: **OpenRouter** — the most installed of them all — together with **Vercel AI Gateway**,
**Cloudflare AI Gateway**, **Kong AI Gateway**, **TrueFoundry** and **Edgee**. The OpenAI and
Anthropic APIs are called directly as a reference line: they are not gateways, they are the
floor that a gateway adds latency to.

---

## Part 1 — Results at a glance

### 1.1 What was measured

Time-to-first-token: the delay between sending a request and receiving the first character
of the model's answer. It is the metric a user actually perceives — the pause before text
starts appearing.

Two metrics were deliberately excluded. Time-to-first-byte measures when a gateway commits
its response headers, which is an architectural choice rather than a latency outcome, and
total response time is dominated by the model's generation speed rather than by the gateway.
Section 3.5 explains both exclusions.

### 1.2 Headline ranking — `gpt-5.4`

Median TTFT, ~1,170 measurements per gateway.

| Rank | Gateway | Median TTFT | Overhead vs direct API | Success |
|---|---|---|---|---|
| 1 | **Edgee** | **798 ms** | **+24 ms** | **100%** |
| 2 | Cloudflare | 811 ms | +37 ms | 97.6% |
| 3 | TrueFoundry | 869 ms | +95 ms | 100% |
| 4 | Vercel | 938 ms | +164 ms | 100% |
| 5 | OpenRouter | 1,020 ms | +246 ms | 97.6% |
| 6 | Kong | 1,718 ms | +944 ms | 100% |
| — | *OpenAI API (direct)* | *774 ms* | *reference* | *97.6%* |

### 1.3 Headline ranking — `claude-sonnet-4-6`

| Rank | Gateway | Median TTFT | Overhead vs direct API | Success |
|---|---|---|---|---|
| 1 | Cloudflare | 1,140 ms | +26 ms | 100% |
| 2 | **Edgee** | **1,215 ms** | **+101 ms** | **100%** |
| 3 | TrueFoundry | 1,232 ms | +118 ms | 100% |
| 4 | Vercel | 1,307 ms | +193 ms | 100% |
| 5 | OpenRouter | 1,321 ms | +207 ms | 97.6% |
| 6 | Kong | 5,101 ms | +3,987 ms | 100% |
| — | *Anthropic API (direct)* | *1,114 ms* | *reference* | *97.6%* |

### 1.4 The five findings

**A well-built gateway costs 25–40 ms, a poorly built one costs 250–950 ms.** The spread
between gateways is an order of magnitude wider than the gap between the fastest gateway and
a direct API call. On `gpt-5.4` the top two sit within 37 ms of the direct API, while the
bottom two add 246 and 944 ms. Choosing the wrong gateway costs more latency than adding a
gateway at all.

**Edgee is fastest on `gpt-5.4`, second on `claude-sonnet-4-6`.** It leads Cloudflare by
13 ms on `gpt-5.4` and trails it by 75 ms on `claude`. No gateway leads on both models, and
on `gpt-5.4` the top two are separated by less than 2%.

**Head-to-head, Edgee delivers the first token sooner in two runs out of three.** Compared
inside the same test run, Edgee was ahead of the other gateways in 70.5% of comparisons on
`gpt-5.4` and 62.9% on `claude-sonnet-4-6`.

**OpenRouter, the most widely installed gateway, is fifth on both models.** It adds 246 ms on
`gpt-5.4` and 207 ms on `claude` over a direct call — roughly ten times the overhead of the
leaders. Popularity and latency are not correlated in this dataset.

**Kong does not stream Anthropic responses.** Its median TTFT on `claude-sonnet-4-6` is
5,101 ms against a 5,102 ms total response time: the first token arrives at the moment the
complete answer finishes. Section 4.5 documents the evidence.

---

## Part 2 — How the measurements are taken

### 2.1 The test harness

A containerised benchmark runs as a Cloud Run job in **43 Google Cloud regions** across six
continents, triggered several times a day by Cloud Scheduler.

Each execution performs the following, in order:

1. Fetch the client's network context (country, continent, connection type, AS name).
2. For each gateway, and for each of the two models, send one identical streaming
   chat-completion request.
3. Record timings, response metadata and network-path details for every request.
4. Write each result to BigQuery as it completes.

Requests inside one execution are issued **sequentially, one second apart**. One execution is
identified by a `batch_name` and constitutes the unit of comparison: *one region, one moment,
one prompt, every gateway*.

### 2.2 The request

All gateways receive the same payload — a single short user message, streaming enabled,
`max_tokens` 3000. Identical prompt text, identical parameters.

Each gateway is called through its documented OpenAI-compatible chat-completions endpoint,
using the official OpenAI SDK, with the model identifier that gateway expects. Gateways hold
their own upstream provider credentials, as they are designed to.

### 2.3 What TTFT means precisely

The timer starts immediately before the HTTP request is issued. The stream is then consumed
chunk by chunk, and **TTFT is stamped on the first chunk carrying non-empty text content**.

That last detail matters. Several gateways emit one or more chunks with an empty `content`
field before the first real token — a role marker, a keep-alive. Counting those would credit
a gateway with a first token it has not delivered. Only content counts.

Measured this way, TTFT includes: network time to the gateway, the gateway's own processing,
the gateway-to-provider hop, the model's prefill, and the return path. It is the complete
user-perceived wait.

### 2.4 Success and failure

A request is successful when the stream completes without raising an error. Failures — HTTP
errors, timeouts, malformed streams — are recorded with their error message.

Two integrity checks were run on this window's data:

- **No request failed while returning HTTP 200.** No gateway hides a failure behind a
  success status.
- **No successful request completed without content.** The harness contains a fallback that
  estimates TTFT when a stream yields no content chunk; that fallback fires on zero rows
  here, meaning every success carries real text.

### 2.5 Window and coverage

| | |
|---|---|
| Period | 5 August 2026 00:00 UTC → 6 August 2026 23:59 UTC |
| Measurements | 16,344 |
| Test runs (batches) | 1,173 |
| Participants | 6 gateways + 2 direct APIs |
| Models | `gpt-5.4`, `claude-sonnet-4-6` |
| Countries / continents | 28 / 6 |
| Overall success rate | 99.14% |

Each gateway contributes 2,322 to 2,350 measurements — a spread of about 1%, meaning all
gateways were exercised in essentially the same runs.

---

## Part 3 — How the numbers are computed and compared

### 3.1 Median, not mean

Latency distributions have a long right tail: a handful of slow requests drags a mean far
above the typical experience. All central figures in this report are **medians (p50)**. The
90th percentile is reported separately when the tail is the subject.

### 3.2 Percentiles are computed on successful requests only

A failed request has no first token, so it cannot contribute to a TTFT percentile. The
consequence is that **a percentile is only meaningful when read next to its success rate** —
a gateway that fails half its requests would otherwise appear fast on the half that worked.
Success rate is therefore a first-class column throughout, never folded into a score.

### 3.3 Model segmentation is mandatory

The two models differ by roughly 400 ms of median TTFT. Any figure aggregating across models
measures the model mix rather than gateway performance. Every table in this report is
segmented by model; no combined ranking is published.

### 3.4 Pooled ranking versus paired comparison

Two different questions require two different computations.

**Pooled ranking** (Part 1) answers *"what latency does this gateway typically deliver?"* It
takes the median of all that gateway's measurements. It is the right basis for a public
league table, but it assumes every gateway was measured under comparable conditions.

**Paired comparison** (Section 4.2) answers *"which of two gateways is faster?"* For every
`(batch, model)` pair it computes `gateway_TTFT − Edgee_TTFT`, then takes the median of those
differences and the share that are positive. Because both numbers come from the same test
run, the same region, seconds apart, this cancels geography, time of day, model and network
conditions simultaneously.

The two can disagree, and when they do the paired result is the reliable one. The clearest
case in this window is Asia on `gpt-5.4`: the pooled medians put Cloudflare 41 ms **ahead** of
Edgee, while the same runs compared pair by pair put Edgee 6 ms ahead, winning 50.6% of them.
The two methods disagree on the direction, and the reason is visible in the sample counts —
306 Cloudflare measurements against 337 for Edgee, so the pooled medians are not computed over
the same set of runs. Only the paired figure compares like with like.

### 3.5 Metrics that were excluded, and why

**Time-to-first-byte (TTFB).** Records when a gateway commits its HTTP response headers.
Gateways differ in *when they choose to*: the OpenAI API itself sends headers only 12 ms
before the first token, whereas a gateway that flushes headers on request acceptance can
report a TTFB of 22 ms that owes nothing to upstream latency. It measures a design decision,
not a latency saved by the user, and is therefore not a ranking metric. It remains valuable
as a **buffering detector** — a large `TTFT − TTFB` gap proves a response was held and
released in one block — which is how Section 4.5 characterises Kong.

**Total response time.** Dominated by the model's token generation speed and the length of
the answer produced, both of which vary run to run for reasons unrelated to the gateway.
Retained as a consistency check only.

**Connection establishment time.** Only populated when the HTTP client opens a fresh
connection. With connection pooling that rate varies from 0% to 97% depending on the gateway
and host, so comparing it across gateways would compare sampling luck.

### 3.6 Suppression thresholds

Any cell backed by fewer than 30 measurements is printed as `—` rather than as a number, and
a 95th percentile additionally requires 100 samples. A gateway whose success rate falls below
95% is excluded from ranking positions and flagged, so that a survivorship-biased percentile
cannot be quoted as a result.

### 3.7 Reproducing these figures

Every table below comes from a single command against the results table:

```bash
GW='Edgee,OpenRouter,Vercel,Cloudflare,Kong,TrueFoundry,OpenAI (Direct),Anthropic (Direct)'

# Pooled ranking, both models
npm run bench rank -- --gateway "$GW" \
  --from 2026-08-05 --to 2026-08-06 --no-common-window --format md

# Paired head-to-head against Edgee
npm run bench rank -- --gateway "$GW" --vs Edgee \
  --from 2026-08-05 --to 2026-08-06 --no-common-window --format md

# Per-continent breakdown
npm run bench rank -- --gateway "$GW" --vs Edgee --model gpt-5.4 --group-by continent \
  --from 2026-08-05 --to 2026-08-06 --no-common-window --min-n 30 --format md
```

---

## Part 4 — Detailed comparative measurements

### 4.1 Distribution of TTFT, not just the median

Medians hide the shape of the distribution. Below, the median, the 90th percentile, and the
ratio between them as a dispersion indicator — a lower ratio means a more predictable gateway.

**`gpt-5.4`**, ordered by p90:

| Gateway | p50 | p90 | p90/p50 |
|---|---|---|---|
| Cloudflare | 811 | 1,154 | 1.42 |
| *OpenAI API (direct)* | *774* | *1,226* | *1.58* |
| TrueFoundry | 869 | 1,282 | 1.48 |
| **Edgee** | **798** | **1,302** | **1.63** |
| Vercel | 938 | 1,650 | 1.76 |
| OpenRouter | 1,020 | 1,806 | 1.77 |
| Kong | 1,718 | 2,260 | 1.32 |

**`claude-sonnet-4-6`**, ordered by p90:

| Gateway | p50 | p90 | p90/p50 |
|---|---|---|---|
| *Anthropic API (direct)* | *1,114* | *2,031* | *1.82* |
| **Edgee** | **1,215** | **2,111** | **1.74** |
| TrueFoundry | 1,232 | 2,120 | 1.72 |
| Cloudflare | 1,140 | 2,155 | 1.89 |
| OpenRouter | 1,321 | 2,323 | 1.76 |
| Vercel | 1,307 | 2,379 | 1.82 |
| Kong | 5,101 | 6,101 | 1.20 |

Two observations worth stating plainly. On `gpt-5.4`, **Edgee has the best median but only
the third best tail among gateways** — its p90 of 1,302 ms sits behind Cloudflare and
TrueFoundry despite a faster median than both. On `claude`, the picture reverses: Edgee has
the best tail of any gateway while ranking second on the median.

Kong's low dispersion ratio on `claude` is not a quality signal — a buffered response is
mechanically consistent because it always waits for completion.

### 4.2 Head-to-head, paired within each test run

For every test run where both gateways returned successfully, the difference in TTFT.
A positive value means the gateway was **slower** than Edgee in that same run.

**`gpt-5.4`**

| Gateway | Paired runs | Median Δ | Edgee faster in |
|---|---|---|---|
| Kong | 1,165 | +879 ms | 95.2% |
| OpenRouter | 1,151 | +197 ms | 76.4% |
| Vercel | 1,165 | +126 ms | 69.2% |
| TrueFoundry | 1,171 | +48 ms | 57.8% |
| Cloudflare | 1,137 | +18 ms | 53.7% |
| *OpenAI API (direct)* | *1,151* | *−26 ms* | *45.1%* |

**`claude-sonnet-4-6`**

| Gateway | Paired runs | Median Δ | Edgee faster in |
|---|---|---|---|
| Kong | 1,165 | +3,854 ms | 98.3% |
| Vercel | 1,165 | +87 ms | 60.7% |
| OpenRouter | 1,151 | +83 ms | 59.4% |
| TrueFoundry | 1,165 | +15 ms | 50.9% |
| Cloudflare | 1,165 | −40 ms | 45.2% |
| *Anthropic API (direct)* | *1,151* | *−83 ms* | *39.5%* |

Across all paired comparisons in the window, Edgee delivered the first token sooner in
**70.5%** of runs on `gpt-5.4` and **62.9%** on `claude-sonnet-4-6`, counting gateways only.
Including the two direct APIs in the denominator, the figures are 66.3% and 59.0%.

Two results are too close to call. Cloudflare on `gpt-5.4` (18 ms, 53.7%) and TrueFoundry on
`claude` (15 ms, 50.9%) are within a coin flip of Edgee and should be read as ties.
Cloudflare's 40 ms advantage on `claude` is the one gap in this group that holds consistently
across the window.

### 4.3 Does the advantage hold in the tail?

A frequent error is to read the 90th percentile of the paired differences as though it were
the difference between the two gateways' 90th percentiles. **They are different quantities
and here they point in opposite directions.**

The p90 of a difference distribution is positive for almost every gateway simply because
run-to-run differences are widely spread: even a gateway that is usually faster has runs
where it is much slower. A positive value only indicates a genuine tail advantage when the
difference distribution is **asymmetric** — when the bad case is worse than the good case is
good.

Testing that directly, with `p10 + p90` as the asymmetry indicator (0 means symmetric):

**`gpt-5.4`**

| Gateway | p10 | p50 | p90 | p10+p90 | Tail advantage? |
|---|---|---|---|---|---|
| Kong | +357 | +879 | +1,455 | **+1,812** | Yes, large |
| OpenRouter | −231 | +197 | +938 | **+707** | Yes |
| Vercel | −286 | +126 | +751 | **+465** | Yes |
| TrueFoundry | −332 | +48 | +446 | +114 | Marginal |
| Cloudflare | −425 | +18 | +365 | −60 | No |
| *OpenAI API (direct)* | *−448* | *−26* | *+381* | *−67* | No |

**`claude-sonnet-4-6`**

| Gateway | p10 | p50 | p90 | p10+p90 | Tail advantage? |
|---|---|---|---|---|---|
| Kong | +3,009 | +3,854 | +4,815 | **+7,824** | Yes, structural |
| Vercel | −694 | +87 | +1,126 | **+432** | Yes |
| OpenRouter | −755 | +83 | +1,064 | **+309** | Yes |
| TrueFoundry | −789 | +15 | +824 | +35 | No |
| Cloudflare | −926 | −40 | +807 | −119 | No |
| *Anthropic API (direct)* | *−994* | *−83* | *+733* | *−261* | No |

**The conclusion is narrow and should be stated as such.** Edgee's advantage widens in the
tail against Kong, OpenRouter and Vercel on both models — the three gateways it already leads
on the median. Against Cloudflare, TrueFoundry and the direct APIs the difference
distribution is symmetric or tilted the other way, and there is no tail claim to make.

### 4.4 Geography

Median TTFT by continent, `gpt-5.4`, 7 participants including the direct API:

| Continent | Fastest | Median | Edgee's rank | Edgee's median |
|---|---|---|---|---|
| Oceania | **Edgee** | 793 ms | **1st** | 793 ms |
| South America | **Edgee** | 818 ms | **1st** | 818 ms |
| Europe | OpenAI API (direct) | 744 ms | 2nd | 774 ms |
| North America | OpenAI API (direct) | 695 ms | 2nd | 704 ms |
| Asia | Cloudflare | 855 ms | 3rd | 896 ms |

Edgee is the fastest gateway on `gpt-5.4` in four of the five measured continents. Asia is
the exception: Cloudflare leads at 855 ms and the direct API comes in at 894 ms, just ahead
of Edgee's 896 ms. Note that in the paired comparison of the same Asian runs, Edgee is 6 ms
ahead of Cloudflare — the two views disagree here, and Section 3.4 explains why the paired
one governs.

Head-to-head against the direct API by region — gateway overhead is not uniform across the
world:

| Continent | Δ vs direct OpenAI API | Edgee faster in |
|---|---|---|
| Oceania | **+24 ms in Edgee's favour** | 59.6% |
| South America | +8 ms in Edgee's favour | 51.9% |
| Asia | −17 ms | 47.6% |
| North America | −26 ms | 43.9% |
| Europe | −45 ms | 40.7% |

In Oceania — the region furthest from the providers' own infrastructure — routing through
Edgee was faster than calling the provider directly in 59.6% of runs. South America points
the same way but at 51.9% is barely distinguishable from a tie on this sample (n=54). In
Europe and North America the direct call retains a 26–45 ms edge. This is the expected
signature of edge presence: the further the client is from the origin, the more a well-placed
intermediary can recover.

On `claude-sonnet-4-6` the direct Anthropic API is fastest in all five continents, and
Cloudflare is the fastest gateway in all five. Edgee is the second gateway everywhere except
Asia, where it is third.

Africa is measured but every cell falls below the 30-sample threshold on a two-day window,
so no figure is published for it.

### 4.5 Kong does not stream Anthropic responses

On `claude-sonnet-4-6`, Kong reports a median TTFT of 5,101 ms against 1,140–1,321 ms for
every other gateway. Its time-to-first-byte separates cause from effect:

| Gateway | TTFB p50 | TTFT p50 | Total p50 |
|---|---|---|---|
| Kong | 5,100 ms | 5,101 ms | 5,102 ms |
| *Typical gateway* | *~1,230 ms* | *~1,240 ms* | *~5,040 ms* |

The three numbers are within 2 ms of each other. Kong's response does not open until the
answer is complete: headers, first token and last token all arrive together.

Direct inspection of the SSE stream confirms it. For an answer of equal length, Kong emits
**17 stream frames on the Anthropic path against 230 on the OpenAI path** — the frames are
aggregated into a few large blocks rather than delivered token by token.

Kong advertises streaming and technically provides it. Functionally, on Anthropic models a
user waits for the entire answer before seeing the first word. The failure is confined to
Anthropic: on `gpt-5.4` Kong streams normally, though still last at 1,718 ms.

### 4.6 Reliability — and what the failures actually are

| Gateway | Requests | Failures | Success rate |
|---|---|---|---|
| Edgee | 2,350 | 0 | 100% |
| TrueFoundry | 2,328 | 0 | 100% |
| Vercel | 2,322 | 0 | 100% |
| Kong | 2,322 | 0 | 100% |
| Cloudflare | 2,322 | 28 | 98.79% |
| OpenRouter | 2,350 | 56 | 97.62% |
| *OpenAI API (direct)* | *1,175* | *28* | *97.62%* |
| *Anthropic API (direct)* | *1,175* | *28* | *97.62%* |

**Every one of the 140 failures in this window came from Hong Kong**, and every one is an
HTTP 403 region restriction issued by the provider. Not a timeout, not a gateway fault:

| Participant | Model | Error |
|---|---|---|
| OpenAI API (direct) | `gpt-5.4` | *Country, region, or territory not supported* |
| Anthropic API (direct) | `claude-sonnet-4-6` | *Request not allowed* |
| Cloudflare | `gpt-5.4` | *Country, region, or territory not supported* |
| OpenRouter | both | *This model is not available in your region* |

The pattern is exactly 28 failures per affected participant and model — the full set of Hong
Kong runs in the window.

This is not a measure of uptime. It measures **where a gateway's requests leave from**. A
gateway that egresses from the client's own region inherits whatever geographic restriction
the provider applies there; a gateway that egresses from its own infrastructure does not.
Cloudflare inherits the block on `gpt-5.4` but not on `claude-sonnet-4-6`, which suggests the
two paths leave from different places.

For a team serving users in a restricted region, that difference decides whether requests
work at all — but it says nothing about resilience to provider outages, which this window
contains none of.

Over the full dataset since 18 June, Edgee's success rate is 100% across more than 19,000
requests. That makes the pattern persistent rather than incidental, but the mechanism is the
one described above, not error absorption.

---

## Part 5 — Limits of this study

- **One prompt shape.** Every measurement uses a single short user message with a short
  answer. Nothing here describes long-context requests, tool calls or large payloads, where
  gateway behaviour may differ substantially.
- **Two models.** `gpt-5.4` and `claude-sonnet-4-6`. No extrapolation to other providers or
  to reasoning models is supported.
- **Two days.** Enough for ~1,170 paired runs per gateway, not enough to characterise
  reliability or to cover Africa.
- **Two results are within noise.** Edgee's 13 ms lead over Cloudflare on `gpt-5.4` and its
  15 ms lead over TrueFoundry on `claude` are small relative to run-to-run variance, and the
  53.7% and 50.9% win rates say the same thing. They should be read as "comparable", not as
  a ranking.
- **Third-party configuration.** Each gateway is configured according to its own
  documentation, but a vendor could reasonably contest a specific setting. Kong in particular
  was measured with the default `ai-proxy-advanced` behaviour; its `claude` figures reflect a
  buffering behaviour that may be specific to this deployment.
- **Published by a participant.** Edgee operates one of the gateways under test. That is why
  the method is described in full, the queries are reproducible, and the results where Edgee
  ranks behind — second on `claude`, third in Asia, third on the `gpt-5.4` tail — are
  reported alongside the rest.

---

*Data: `edgee-prod.benchmark_app.results`, 5–6 August 2026. Raw and derived data: [`data/`](data/). Harness and ranking tool:
[gateway-bench](https://github.com/edgee-ai/gateway-bench).*
