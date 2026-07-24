# ADR-0001: Overall architecture topology

- **Status:** Accepted
- **Date:** 2026-07-24
- **Milestone:** — (foundational; governs all others)

## Context

The v1 pipeline is a single Node.js process with one sequential `while` loop
that both *decides what to scrape* (which API page) and *does the scraping*
(`scraper/load_cars.js`, `scraper/scraper.js`). Three properties make it unfit
for the rebuild's goals:

1. **Sequential** — page N+1 waits on page N; rows are inserted one at a time
   with 4+ serial DB round-trips each. Throughput is capped at one machine
   doing one thing at a time.
2. **Fail-fast** — any `403 / 429 / 5xx` executes `break`, killing the entire
   run on a single transient error.
3. **Manual recovery** — the only resume mechanism is a hand-passed `startPage`
   CLI argument; a human must babysit the process.

The root cause is **coupling**: deciding and doing share one loop, so a failure
in one destroys the other.

The goal for the rebuild (from the project brief): a **fault-tolerant,
horizontally scalable** platform that runs under Docker Compose, survives a
worker crash mid-job without losing or duplicating data, and is defensible from
first principles in a technical interview.

## Concept check

The relevant concept is the **producer/consumer pattern** backed by an
**external queue** (FIFO ADT). A producer enqueues work items and walks away; a
pool of consumers each pull and process one item at a time. Because the queue
lives *outside* any single process, (a) many workers can share it → horizontal
scaling, and (b) an unacknowledged job is redelivered if its worker dies →
fault tolerance. Full explanation:
[`../CONCEPTS.md`](../CONCEPTS.md#producer--consumer-the-job-queue).

## Options considered

### Option 1 — External job queue + stateless worker fleet + Docker Compose
- **Pros:** genuinely fault-tolerant (crash → redelivery); genuinely
  horizontally scalable (add worker containers); mirrors how real ingestion
  pipelines are built; satisfies all three definition-of-done bullets.
- **Cons:** most moving parts to learn and operate; you run a broker.
- **Complexity / Big-O:** enqueue/dequeue are O(1) per job; total throughput
  ≈ (worker count × per-page processing time).
- **Interview relevance:** the reference answer for "design a scalable
  scraping / ingestion system"; unlocks the full vocabulary — queues,
  idempotency, retries, backoff, backpressure, dead-letter queues.

### Option 2 — In-process concurrency (promise pool / worker_threads), no external broker
- **Pros:** much simpler; no broker to run; still far faster than v1 by
  processing many pages at once.
- **Cons:** **not** horizontally scalable (one-machine ceiling); if the process
  dies, all in-flight work is lost — **fails the "survive a worker crash"
  requirement.**
- **Interview relevance:** teaches concurrency primitives and bounded pools, but
  not distributed systems.

### Option 3 — Fully managed / cloud-native (e.g. SQS + Lambda workers)
- **Pros:** least ops; auto-scaling.
- **Cons:** cannot run locally under Docker Compose (against the DoD);
  Puppeteer-in-Lambda is painful; hides the very mechanics we want to learn and
  explain.
- **Interview relevance:** good to *name* as an alternative; wrong for a
  learning-focused local build.

## Decision

**Option 1 — external job queue + stateless worker fleet + Docker Compose.**

It is the only option that satisfies all three definition-of-done bullets (runs
under Compose, survives a worker crash, no data loss/duplication) and it
produces the strongest interview narrative: a real distributed design defensible
from first principles rather than a souped-up single process.

## Consequences

- **Positive:** work is partitioned into independent jobs; workers are stateless
  and interchangeable, so capacity scales by running more containers; a worker
  crash costs at most one redelivered job, not the run.
- **Negative / cost:** we now operate a broker and more services; we must design
  for **at-least-once** delivery, which forces **idempotent** writes (already
  helped by v1's `ON CONFLICT (url)`); N parallel workers create rate-limit /
  backpressure and shared-session-header problems v1 never had.
- **Follow-on decisions unlocked:**
  - ADR-0002 — queue technology (broker choice)
  - ADR-0003 — job granularity (what is one "job")
  - ADR-0004 — delivery guarantee & idempotency strategy
  - ADR-0005 — retry / backoff strategy
  - ADR-0006 — session-header sharing & refresh
  - ADR-0007 — schema & migrations
  - ADR-0008 — Docker Compose topology
  - ADR-0009 — observability & health checks

## Concepts introduced

- [Producer / Consumer](../CONCEPTS.md#producer--consumer-the-job-queue)
- [Queue (FIFO) ADT](../CONCEPTS.md#queue-fifo-as-an-abstract-data-type)
- [Horizontal vs. vertical scaling](../CONCEPTS.md#horizontal-vs-vertical-scaling)
- [Fault tolerance via redelivery](../CONCEPTS.md#fault-tolerance-via-redelivery)
- [At-least-once delivery & idempotency](../CONCEPTS.md#at-least-once-delivery--idempotency)
