# Decision Log (ADRs)

This folder holds **Architecture Decision Records** — one short, dated file per
non-trivial choice, capturing *context → options considered → the decision →
consequences*. The point is that anyone (including future-me in an interview)
can reconstruct **why** the system is the way it is, not just what it does.

Format: [`0000-template.md`](0000-template.md).

## Index

| # | Decision | Status | Milestone |
|---|----------|--------|-----------|
| [0001](0001-architecture-topology.md) | Overall architecture topology | ✅ Accepted | — |
| 0002 | Queue technology (broker choice) | ⏳ Pending | M2 |
| 0003 | Job granularity (what is one "job") | ⏳ Pending | M2 |
| 0004 | Delivery guarantee & idempotency strategy | ⏳ Pending | M3 |
| 0005 | Retry / backoff strategy | ⏳ Pending | M3 |
| 0006 | Session-header sharing & refresh | ⏳ Pending | M4 |
| 0007 | Schema & migrations (into version control) | ⏳ Pending | M1 |
| 0008 | Docker Compose topology | ⏳ Pending | M1–M4 |
| 0009 | Observability & health checks | ⏳ Pending | M5 |

**Status legend:** ✅ Accepted · ⏳ Pending · 🔄 Superseded · ❌ Rejected

> Pending rows are placeholders so the roadmap is visible; their ADR files are
> written when we reach the decision. This index is updated as each is accepted.
