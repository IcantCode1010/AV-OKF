# Navigation Profiles

Phase A profiles live here as `<profile-id>.v<version>.yaml`. Load profiles by ID and positive integer version through `loadNavigationProfile`; never construct paths from unchecked user input.

The loader validates placements against a supplied Project EFB registry and types against the active OKF type definitions. A two-digit ATA value is not sufficient: the receiver must support it. Generic future consumers may supply their own registry without changing chapter-specific compiler code.

Every profile declares one root, ordered hubs, applicable article types, explicit standalone policy, and deterministic ordering. Hub rules are exact matches against structured metadata fields, with no implicit title matching or arbitrary executable expressions. Repeated field/value rules are rejected as ambiguous. Later membership compilation must also reject articles that match different fields in conflicting hubs.

Membership priority for Phase C remains: approved assignment, source hierarchy, structured classification, profile rules, manual assignment. `explicit-approved-only` permits a standalone article only with an explicit approved root assignment; it does not make unassigned articles standalone automatically.

The loader returns deeply frozen normalized data and the source file SHA-256. Published profile versions must never be edited. Add a new versioned file for changes, retain the old one, and generate a new immutable package. Record the exact profile identity/version/hash and compiler version during package integration. Immutability is currently a version-control policy; publication-ledger enforcement belongs to package integration.

ATA 27's nine hubs are configuration only. The schema also supports other ATA targets and pilot QRH profiles. Phase A tests validate this schema reuse; they do not claim full compiler modularity, which is Phase G.

Verification: `pnpm --dir apps/web exec tsx --test src/lib/navigation-profile.test.mts`.
