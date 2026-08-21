# UAIR Office Showcase

## Product message

```text
AI can recommend.
Policy still governs.
```

The demo should communicate UAIR in under 30 seconds:

1. Enter or keep the prefilled expense request.
2. Click `提交并启动 Workflow`.
3. Watch the right-hand execution trace populate.
4. AI produces a policy/risk recommendation.
5. The Workflow stops at `ExpenseManagerApproval`.
6. Explain that the process may now die and the execution remains durable.
7. Click `批准并继续`.
8. Show the final persist + immutable audit nodes appearing after approval.

## Why it is designed this way

The main visual hierarchy is:

```text
business request
AI recommendation
human decision
execution proof
```

not:

```text
framework configuration
graph editor
developer settings
```

This makes the demo usable on a landing page, GitHub README, demo video, or enterprise presentation.

## Demo route

```text
oa.expense.apply
```

The ID is declared once in code and runtime registration uses the Workflow object itself.

## Verified runtime result

```text
initial status:
suspended

pending UI:
ExpenseManagerApproval

after approval:
completed

audit:
immutable = true

History:
11 events
```


## v0.39 presentation polish

The showcase now includes a presentation-oriented visual sequence:

- cinematic intro overlay for recordings and live demos;
- four-stage Request → AI Review → Human Gate → Commit rail;
- explicit animated `EXECUTION SUSPENDED` state;
- progressive execution-trace entrance animations;
- durable-commit confirmation after resume;
- stronger visual separation between AI recommendation and mandatory human governance.

The intended 20–30 second demo story is now:

```text
Enter demo
→ submit realistic request
→ watch durable execution populate
→ AI recommendation appears
→ execution visibly SUSPENDS
→ explain that the process can disappear safely
→ approve
→ execution resumes
→ persist + immutable audit appear
→ COMMIT
```


## v0.40 — real process-death recovery demo

The flagship demo now proves durability instead of only describing it.

### Demo sequence

```text
submit request
→ Workflow suspends at ExpenseManagerApproval
→ kill the Node.js server
→ browser detects Runtime offline
→ restart the Node.js server
→ browser detects a new runtime boot ID
→ the exact same Suspension is recovered from storage
→ approve
→ Workflow resumes
→ persist + immutable audit
→ completed
```

The UI exposes this as a deliberate presentation moment:

```text
Runtime offline
Suspension is persisted. Waiting for server restart…

RUNTIME RESTART DETECTED
new process took over
pending Suspension recovered from durable state
```

The browser remembers the current execution ID in session storage and automatically reloads that execution after runtime recovery.

### Verified real result

A real server process was killed and restarted during verification:

```text
before kill:
status = suspended

after restart:
status = suspended

boot ID changed:
true

Suspension ID remained identical:
true

after human decision:
status = completed

mandatory audit immutable:
true
```

This is the core UAIR demonstration: the UI wait belongs to durable application control flow, not to the lifetime of the server process.
