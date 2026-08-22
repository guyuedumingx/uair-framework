# Delivery, effects and idempotency contract

UAIR does not claim universal exactly-once external side effects.

## Guarantees by boundary

| Boundary | Contract |
| --- | --- |
| Queue job delivery | At least once until a valid lease holder ACKs |
| Execution persistence | Optimistic revision/adapter transaction semantics |
| Completed Component replay | Recorded output is reused and the handler is not called again |
| Component retry | The same `effectId` is reused for every attempt in one generation |
| Expired/stale result | A new generation and new `effectId` are created |
| External side effect | Exactly once only when the downstream operation deduplicates by `effectId` or is otherwise idempotent |

## The uncertainty window

```text
external system accepts side effect
→ worker crashes
→ effect_completed has not reached durable History
→ another worker retries the Component
```

No application runtime can infer whether the external system accepted the first
request. The Component must pass `ctx.effectId` as the provider idempotency key,
write through an idempotent transactional boundary, or reconcile before retry.

```ts
const charge = component(
  "payments.charge",
  async (request, ctx) =>
    paymentProvider.charge({
      ...request,
      idempotencyKey: ctx.effectId
    })
);
```

## Ownership and fencing

A queue lease grants temporary delivery ownership, not permission for stale
workers to commit forever. Queue adapters must reject ACK/NACK/lease extension
with an invalid token. Storage adapters must reject stale revisions. A host that
needs strict cross-resource fencing must propagate its fencing token to the
external resource or use a transaction/outbox that covers both durable facts.

## Terminology rule

Documentation may say "logical completed effects are replay-safe". It must not
say "all external effects execute exactly once" without naming the downstream
idempotency mechanism and tested failure model.
