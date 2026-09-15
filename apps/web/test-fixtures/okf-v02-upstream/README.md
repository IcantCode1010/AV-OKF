# Pinned OKF v0.2 compatibility corpus

This directory contains the four sample OKF bundles published in
`GoogleCloudPlatform/knowledge-catalog` at commit
`fe3268a70e8ca5110a43a8f1dfdf6d1a458cf79f`:

- `acme_retail`
- `crypto_bitcoin`
- `ga4`
- `stackoverflow`

The source repository is licensed under Apache-2.0. Its OKF license is retained
at `okf/LICENSE.md`. The exact source paths and SHA-256 digests are recorded in
`manifest.json`.

Generated `viz.html` files are intentionally excluded. The Python attester in
the Acme Retail bundle is retained only as a referenced bundle resource. Tests
must never import, execute, or fetch resources from this corpus.

The files are read-only compatibility fixtures. Updating them requires pinning
a new upstream commit, regenerating every digest and compatibility report, and
reviewing the change as a separate repository update.
