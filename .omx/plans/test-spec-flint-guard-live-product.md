# Test Spec: Flint Guard Live Product Phases A/B/C

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
- `diff idl/flint.json target/idl/flint.json`

## Behavior to verify

1. Live mode is the dominant first-run posture.
2. Trade clearly surfaces route posture and recommendation after quote evaluation.
3. Watch shows automatic risk boards without requiring manual watchlist input.
4. Protect clearly surfaces risky-order exposure and preserves cancel workflows.
5. Existing feed / bundle / incident logic still works after the UI/product refocus.
