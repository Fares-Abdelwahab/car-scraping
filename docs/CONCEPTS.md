# Concepts

A running, plain-language glossary of the DSA and distributed-systems concepts
this project touches. It exists so the README and architecture docs can use
terms freely while this file explains each one from first principles — and so
there's one place to revise from before an interview.

Each entry: **what it is → why it matters here → interview relevance** (and the
classic pattern where one applies).

Entries marked *(preview)* are concepts we've named but not yet built; they'll
be expanded when we reach the milestone that uses them.

---

## Producer / Consumer (the job queue)

**What it is.** A design that separates *deciding what work exists* (the
**producer**) from *doing the work* (the **consumer / worker**), with a
**queue** in between. The producer writes work items into the queue and walks
away; consumers pull items out and process them, one at a time each. Neither
side calls the other directly — they only ever touch the queue.

**Why it matters here.** v1 fused both roles into one `while` loop, so a failure
while scraping page 76 also killed the logic that decides to scrape page 77.
Splitting them means a worker can die without taking the run down: its
unfinished job goes back on the queue for someone else.

**Interview relevance.** This is the **bounded-buffer / producer-consumer**
problem — a canonical concurrency and systems-design question. Expect
follow-ups: "what if producers outrun consumers?" (→ [Backpressure](#backpressure-preview)),
"what if a consumer crashes mid-item?" (→ [At-least-once](#at-least-once-delivery--idempotency)).

---

## Queue (FIFO) as an abstract data type

**What it is.** A **queue** is a First-In-First-Out (FIFO) collection: you
`enqueue` at the back and `dequeue` from the front, so items come out in the
order they went in — like a line at a shop. Both operations are **O(1)**
(constant time) when backed by a linked list or a ring buffer, because you only
ever touch the two ends, never walk the middle.

- Contrast with a **stack** (LIFO — last in, first out; `push`/`pop` the same
  end).
- Contrast with a **priority queue**, where `dequeue` returns the
  highest-priority item rather than the oldest — typically backed by a **heap**
  (a binary tree kept partially ordered so the min/max is always at the root;
  insert and extract are **O(log n)**). We may use one if some pages/sources
  need to jump the line.

**Why it matters here.** Our job queue is a FIFO of "scrape page N" messages.
The twist that makes it *distributed* rather than an in-memory `[]` is that it
lives **outside** any single process (in a broker), so many workers on many
machines can share it safely.

**Interview relevance.** Queues underlie BFS (breadth-first search visits nodes
in FIFO order), sliding-window and "recent items" problems (often a **deque** —
double-ended queue), and rate limiters. Knowing the O(1)-both-ends property and
why (only the ends are touched) is a common fundamentals check.

---

## Horizontal vs. vertical scaling

**What it is.**
- **Vertical scaling** = make one machine bigger (more CPU/RAM). Simple, but has
  a hard ceiling and a single point of failure.
- **Horizontal scaling** = add more machines/processes that share the load.
  Near-unlimited headroom and no single point of failure — but only works if the
  work can be *partitioned* and the workers are *stateless enough* to run
  independently.

**Why it matters here.** v1 could only scale vertically (buy a faster box) and
still processed one page at a time. The queue makes workers **stateless and
interchangeable**, so scaling out is literally "run more worker containers"
(`docker compose up --scale worker=N`).

**Interview relevance.** Core system-design vocabulary. The key insight
interviewers probe: horizontal scaling requires *partitionable work* and
*shared coordination state* (here, the queue) — you can't just add machines to
a design that assumes one.

---

## Fault tolerance via redelivery

**What it is.** The system keeps working correctly even when parts of it fail.
For a job queue, the core mechanism is **redelivery**: a job handed to a worker
isn't deleted from the queue — it's held "invisible" until the worker
**acknowledges** success. If the worker dies first, a **visibility timeout**
expires and the job becomes available again for another worker.

**Why it matters here.** This is the guarantee behind our definition-of-done
demo: kill a worker mid-scrape and *no page is lost* — it gets reprocessed.

**Interview relevance.** Leads directly into delivery guarantees (below). The
subtle point interviewers want: redelivery gives you *at-least-once*, which
means you must also make processing safe to repeat (idempotency).

---

## At-least-once delivery & idempotency

**What it is.**
- **Delivery guarantees** describe how many times a message might be processed:
  - *At-most-once*: never reprocessed, but may be lost on crash. (Fast, unsafe.)
  - *At-least-once*: never lost, but **may be processed more than once** on
    crash/redelivery. (Safe against loss; the common default.)
  - *Exactly-once*: never lost, never duplicated — the ideal, but expensive and,
    in the strict sense, impossible end-to-end without extra machinery.
- **Idempotency** = an operation you can apply repeatedly and get the same
  result as applying it once. It's the trick that makes at-least-once *safe*: if
  reprocessing a page can't create duplicates, then "maybe twice" is harmless.

**Why it matters here.** We'll run **at-least-once** (we'd rather reprocess a
page than lose it). v1 already gives us a head start on idempotency: writes use
`INSERT ... ON CONFLICT (url) DO NOTHING`, so inserting the same listing twice
is a no-op. That single clause is what lets a redelivered job be safe.

**Interview relevance.** "How do you get exactly-once?" is a classic trap — the
strong answer is *"you usually don't; you do at-least-once + idempotent
consumers."* The dedup-by-key idea is the same **hash-set membership** trick
from LeetCode ("have I seen this key before?" → O(1) average lookup in a hash
set), just enforced by a unique index in the database.

*(Full treatment when we build M3.)*

---

## Retry & exponential backoff *(preview)*

**What it is.** When a job fails on a transient error (a `429 Too Many
Requests`, a network blip), you retry — but not immediately and not forever.
**Exponential backoff** waits `base × 2^attempt` between tries (1s, 2s, 4s,
8s…), so a struggling server gets increasing breathing room. **Jitter** adds
randomness to those delays so many workers don't retry in lockstep (a
"thundering herd").

**Why it matters here.** v1 does the opposite — it `break`s on the first error.
Backoff turns transient failures into non-events.

**Interview relevance.** The doubling interval is the same growth pattern as
**exponential search / binary-search bounds** (repeatedly doubling a range).
Naming "exponential backoff **with jitter**" and *why* jitter matters
(decorrelating retries) is a strong signal.

*(Full treatment when we build M3.)*

---

## Dead-letter queue (DLQ) *(preview)*

**What it is.** A separate queue where a job lands after it has failed its
maximum number of retries. Instead of a "poison" job (one that will *never*
succeed — e.g. a permanently malformed page) blocking the pipeline or looping
forever, it's set aside for a human to inspect while the rest of the run
continues.

**Why it matters here.** Keeps one bad page from stalling the whole scrape, and
gives us a place to see *what* failed.

**Interview relevance.** Shows you distinguish **transient** failures (retry)
from **permanent** ones (set aside) — a maturity signal in systems design.

*(Full treatment when we build M3.)*

---

## Backpressure *(preview)*

**What it is.** A mechanism that stops a fast producer from overwhelming slower
consumers — usually by **bounding** the queue (a maximum size) so the producer
must slow down or wait when the queue is full. In a scraper, backpressure also
means the *target site*: N workers hammering ContactCars in parallel will earn
`429`s, so we must cap the *effective* request rate across all workers, not just
per worker.

**Why it matters here.** More workers = faster, but also = more likely to get
rate-limited or blocked. Backpressure + a shared rate limit is how we scale out
without getting banned.

**Interview relevance.** The "what happens when the buffer fills?" follow-up to
producer/consumer. Bounded buffers, credit-based flow control, and token-bucket
rate limiting all live here.

*(Full treatment when we build M4.)*
