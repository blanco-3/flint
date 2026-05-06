# Context Snapshot

- task statement:
  - Continue Flint Guard beyond console-local artifacts.
  - Implement the next defensible layer: shared incident bundle usability, action profiles, and a shared safety feed skeleton.
- desired outcome:
  - Current safety artifacts remain stable in the console.
  - External consumers (SDK / relay) can understand and fetch a first safety-feed contract.
  - The app exposes action profiles so recommendations vary by actor, not just by policy preset.
- known facts/evidence:
  - Incident Pack, Decision Report, Panic Action Plan, and deterministic audit bundle exist in `src/lib/`.
  - Front-end build/lint/tests pass.
  - Relay and SDK checks pass.
  - Legacy Flint build/test pass.
- constraints:
  - No broad backend rewrite.
  - Reuse the current relay store/server where possible.
  - Keep the UI thin; place logic in `src/lib/`.
  - Avoid new dependencies.
- likely touchpoints:
  - `flint-console/src/lib/guard-types.ts`
  - `flint-console/src/lib/guard-report.ts`
  - new `guard-action.ts`, `guard-feed.ts`
  - `flint-console/src/App.tsx`
  - `sdk/`
  - `relay/server.js`, `relay/store.js`, `relay/relay.test.js`, `relay/openapi.json`

