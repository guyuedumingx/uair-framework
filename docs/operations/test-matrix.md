# UAIR v1-alpha Test Matrix

| Area | SQLite/local | PostgreSQL | Multi-process | Chaos | Status |
|---|---:|---:|---:|---:|---|
| Workflow replay | Yes | Not yet | Yes | Yes | Strong |
| Effect dedup after redelivery | Yes | Not yet | Yes | Yes | Strong on SQLite |
| Suspension/resume | Yes | Not yet | Yes | Yes | Strong on SQLite |
| Fencing / stale owner rejection | Yes | Not yet | Yes | Yes | Strong on SQLite |
| Workflow version pinning | Yes | Schema/compile only | Yes | Yes | Strong on SQLite |
| Code fingerprint identity | Yes | Schema/compile only | Yes | Yes | Strong on SQLite |
| Worker routing | Yes | Contract only | Yes | Yes | Strong on SQLite |
| Queue claim uniqueness | Yes | Live Mac PASS | Yes | Yes | Local real-PG evidence; CI observation pending |
| Visibility timeout/redelivery | Yes | Live Mac PASS | Yes | Yes | Local real-PG evidence; CI observation pending |
| Shared worker registry | Yes | Live Mac PASS | Yes | Yes | Local real-PG evidence; CI observation pending |
| Atomic capacity reservation | Yes | Live Mac PASS | Yes | Yes | Local real-PG evidence; CI observation pending |
| Scheduler leaderlessness | Yes | Live Mac PASS | Yes | Yes | Local real-PG evidence; CI observation pending |
| MCP client adapter | Yes | N/A | Cross-process stdio | Partial | Good |
| MCP Runtime server | JSON file | N/A | stdio + Streamable HTTP | Disconnect/restart | Reference PASS |
| MCP OAuth interoperability | N/A | N/A | Test bearer middleware only | No | Production OAuth not yet live-tested |
| MCP Tasks fallback | Yes | N/A | Yes | Client restart | SDK 2.0.0 fallback verified |
| UI blocking resume | Yes | N/A | N/A | Partial | Good |
| Dynamic package sandbox contract | Fake runner | N/A | N/A | No | Real sandbox missing |
| OpenTelemetry projection | Yes | N/A | N/A | No | Projection verified |

## v1-alpha release gates

Required before tagging v1-alpha:

- [x] Application API separated from runtime/cluster/internal APIs.
- [x] Deterministic seeded SQLite Chaos Harness.
- [x] Multi-process SQLite queue claim/reclaim/capacity tests.
- [x] Workflow version + fingerprint + deployment identity.
- [x] API-surface drift check in repository scripts.
- [ ] Real PostgreSQL CI service with concurrent schedulers/workers: local
  PostgreSQL 16 execution passes; the first observed green GitHub Actions run
  is still required.
- [ ] Real process `kill -9` worker fault test, not only modeled crash.
- [ ] 10k+ execution soak with memory/DB growth measurements.
- [ ] History/schema migration fixtures across at least two released artifacts.
- [ ] Real sandbox backend integration test.
- [ ] Security review of dynamic package acquisition.

## v1 stable gates

Do not call UAIR production-ready until all v1-alpha gates are complete plus:

- PostgreSQL chaos passes repeatedly under connection churn.
- Upgrade/downgrade operational playbook exists.
- Backup/restore and disaster-recovery behavior is tested.
- Queue/DLQ operator workflow is documented.
- Metrics/SLO guidance exists.
- Package provenance and dependency threat model is reviewed.


## v0.46 Builder contract gates

```text
check:contracts
  Component input narrowing                         PASS
  Component output breakage                         PASS
  Surface data narrowing                            PASS
  Surface action narrowing                          PASS
  pending durable Surface payload incompatibility  PASS

check:project-awareness
  source Workflow v2 detection                      PASS
  automatic target v3                              PASS
  ChangeSet safe                                    PASS
  Contract compatibility                            PASS
  1 pending payload compatible                      PASS
  live Runtime risk high                            PASS
```
