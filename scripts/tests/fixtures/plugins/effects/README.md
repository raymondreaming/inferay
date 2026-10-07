# Local effect destination

`destination.py` is a disposable conformance destination, not an installed plugin
or publishing integration. It uses a separate SQLite ledger and never accesses
network services or credentials. Its JSON stdin operations are fixture protocol;
they do not declare a supported Inferay handler manifest.

- `deliver` accepts a delivery ID, intent hash, payload and fixture time. Repeating
  the same request returns the same receipt; conflicting contents are refused.
- `loseReply` commits the receipt and exits without returning it.
- `reconcile` looks up the original delivery ID without delivering again.

The native outbox storage checks use this process to prove lost-reply recovery,
plus separate tests for concurrency, time limits, approval changes and dismissal:

```sh
cargo test -p inferay-server outbox_ --lib
```

These tests exercise production queue storage and a separate destination ledger.
The handler binding, user approval controls and production delivery worker are not
wired yet. This is not the completed end-to-end delivery gate described in
[Effects](../../../../../docs/effects.md).
