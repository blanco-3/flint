# Flint Guard Colosseum Scorecard

This scorecard is intentionally harsh and is used as the working quality bar during Ralph mode.

| Judge Persona | Current Score | Why |
| --- | --- | --- |
| Protocol / Engineering | 8.0 / 10 | Real on-chain kernel, real devnet artifacts, real wallet tx build paths, seeded demo fallback |
| Product | 7.0 / 10 | Clear safety-first routing + panic-order story, but still shares repo surface with legacy Flint positioning |
| Security / Risk | 7.0 / 10 | Explicit risk policy, fail-closed treasury metadata stance, panic candidate logic, but still partially dependent on third-party data quality |
| GTM / Integration | 6.5 / 10 | Relay/API + SDK exist and remain usable, but Guard console is the stronger current demo surface |
| Demo / Storytelling | 8.0 / 10 | Seeded demo mode, reset/export bundle, incident logs, and local buildable console make the story much more deterministic |

## Remaining weaknesses

1. Product positioning is still split between legacy protected-execution infrastructure and the newer Guard console story.
2. Browser-wallet E2E evidence is still weaker than static verification and seeded simulation.
3. Relay-backed visible console flow is not yet as strong as the direct Guard route/panic experience.

## Submission stance

The current recommended demo posture is:

1. start in seeded demo mode
2. show why the best route is rejected
3. show safer-route execution simulation
4. show panic-order triage and cancellation simulation
5. switch to live API mode to prove the wallet + Jupiter path is real
6. close with the relay/API and SDK as the integration expansion path
