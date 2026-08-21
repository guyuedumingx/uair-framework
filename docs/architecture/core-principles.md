# UAIR Core Admission Rule

A new public Core primitive is admissible only if all are true:

1. It is required by durable execution correctness, not only developer convenience.
2. It naturally applies across at least five unrelated domains.
3. Existing Workflow / Component / Effect / Suspension / History / Execution
   composition cannot express it safely.
4. It does not depend on UI, Agent framework, identity provider, organization,
   cloud, database, package ecosystem, or a specific business domain.
5. Keeping it outside Core would create duplicate durable truth or make a
   correctness guarantee impossible.

Examples currently outside Core:

```text
Agent
Memory
Skill
User
Role
Approval
Interaction (typed Suspension package)
Notification
Channel
Tenant
Order
Asset
Risk
```

This file is a design gate, not a claim that Core can never evolve.
