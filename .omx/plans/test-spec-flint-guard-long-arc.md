# Test Spec: Flint Guard Long Arc Iteration 1

## Primary verification

- `npm --prefix flint-console run build`
- `npm --prefix flint-console run lint`
- `yarn run guard:test`

## Regression verification

- `yarn run relay:test`
- `yarn run sdk:check`

## Legacy Flint verification

- `./scripts/build.sh`
- `./scripts/test.sh`

## Behavior to verify in this iteration

1. Incident Pack logic is deterministic and portable
2. Decision report generation is pure-function based
3. Panic Action Plan summarizes what to do next from current state
4. Audit trail export uses stable structure and human-readable semantics
5. Existing trade/protect flows continue working

