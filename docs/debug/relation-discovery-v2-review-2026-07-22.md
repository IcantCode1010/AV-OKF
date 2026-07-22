# Relation Discovery V2 Dry-Run Review

Date: 2026-07-22

## Scope

- Live bundle: `737ng`
- Profile: Aviation
- Approved exported concepts: 31
- Full machine report: [`relation-discovery-v2-2026-07-22.json`](relation-discovery-v2-2026-07-22.json)
- Generic coverage: deterministic Generic fixture in the machine report; no populated live Generic bundle was available in the current workspace.
- Mode: dry run only. No relation candidate, topic record, or OKF file was changed.

## Before And After

| Measure | Prior heuristic | V2 |
| --- | ---: | ---: |
| Candidate pairs before graph preflight | 346 | 156 |
| Prior candidates removed by V2 quality gates | 0 | 190 |
| Candidates accepted by graph preflight | Not available | 69 |
| Candidates suppressed by graph preflight | Not available | 87 |

All 87 suppressions were exact duplicates of an existing approved or pending edge. The accepted V2 candidates preserve stable path-based direction and include their actual matched terms/tags. Reverse `references` or `supports` edges remain warnings, not automatic rejection, by the approved policy.

## Human Sample

Twelve V2-accepted candidates were reviewed from the report.

| Proposed relation | Decision | Direction correction | Reason |
| --- | --- | --- | --- |
| Emergency Scenarios and Procedures `references` Engine and APU Emergency Procedures | Accept | No | General emergency concept points to a specific engine/APU emergency concept. |
| Engine Bleed Air Trip Off Procedures `references` Engine Overheat Response Procedure | Accept | No | Both concepts concern related engine bleed/overheat handling. |
| Engine Overheat Response Procedure `references` Warning Lights and Indicators | Accept | No | Warning indications are relevant context for the overheat response. |
| Engine Start with APU Air Unavailable `supports` No Engine Bleed Configuration | Accept | Yes | The broader no-bleed configuration should be the source supporting the specific start case. |
| ACARS and Radio Communication Failures `references` Cabin Altitude Warning Procedures | Reject | N/A | Shared words are procedural boilerplate, not a substantive relationship. |
| Airspeed Management Procedure `references` Cabin Altitude Warning Procedures | Reject | N/A | No direct operational relationship is established. |
| Airspeed Management Procedure `supports` CDS Fault Management | Reject | N/A | Page proximity and generic management wording are insufficient. |
| Airspeed Management Procedure `references` Wheel Well Fire Response | Reject | N/A | Generic response wording creates a false positive. |
| Altitude Disagreement Response `references` APU Fire Response Procedure | Reject | N/A | Shared checklist/response language is not a relationship. |
| Engine Start with APU Air Unavailable `supports` Fuel Balancing Procedure | Reject | N/A | Page proximity and `section` do not establish a relation. |
| Engine Start with APU Air Unavailable `references` GPS Failure Procedure | Reject | N/A | Generic `when`/`ensuring` wording creates a false positive. |
| Evacuation Procedure `references` No Engine Bleed Configuration | Reject | N/A | Generic section/including wording creates a false positive. |

Sample metrics:

- Acceptance rate: 4/12 (33.3%).
- False positives: 8/12 (66.7%).
- Direction corrections: 1/4 accepted candidates (25%).
- Confirmed missed relations: 0 within this candidate sample. Bundle-wide missed-relation recall was not measured because it requires reviewing all non-candidate concept pairs.

## Finding

V2 substantially reduces the candidate pool and closes graph-integrity gaps, but the sampled precision is not yet high enough to justify semantic top-K expansion, broader LLM classification, or bulk approval. The remaining noise is driven mainly by boilerplate terms (`including`, plural `procedures`, `management`) and the current same-source/page-proximity signal combination.

The next reviewed adjustment should remain deterministic: tune profile stopwords and evaluate whether page proximity needs a stronger companion signal. Then rerun this same report and sample. Embedding-based neighbors and expanded LLM authority remain deferred.
