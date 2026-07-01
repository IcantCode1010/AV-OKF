# Product Requirements Document
_AV-OKF - Agentic Aviation Maintenance Knowledge System_


## Executive Summary
AV-OKF is a structured, agent-operable aviation maintenance knowledge system. It turns aircraft technical manuals, training documents, routing rules, ATA classifiers, source manifests, and fault routes into a navigable Markdown knowledge bundle that AI agents can read, validate, and cite. The product is not a simple chatbot over PDFs. It is a controlled technical triage layer that combines structured knowledge, hybrid retrieval, specialist agents, and evidence validation.
The system must help an agent classify a user-reported aircraft fault, identify aircraft family and effectivity, map symptoms to ATA chapters, select the correct manual authority, retrieve source-backed evidence, and produce a clear answer without inventing dispatch, procedure, part, wiring, or task-number conclusions.

## Contents
1. Product Vision and Goals
2. Problem Statement
3. Users and Jobs To Be Done
4. Scope
5. Product Architecture
6. Agent Integration Model
7. Knowledge Format Requirements
8. Retrieval and Navigation Requirements
9. Evidence Validation and Safety Rules
10. MVP Requirements
11. User Experience Requirements
12. Data Model and Repository Structure
13. Non-Functional Requirements
14. Success Metrics
15. Risks and Mitigations
16. Release Plan
17. Open Questions

## 1. Product Vision and Goals
### Vision
Build the safest and most explainable agentic maintenance triage layer for aircraft technical knowledge. AV-OKF should let agents reason through manuals the way a strong maintenance controller or technician would: identify the aircraft, classify the problem, select the correct manual, verify effectivity, and cite source evidence.
### Goals
- Provide a structured aviation knowledge format that is human-readable, Git-friendly, and agent-readable.
- Support hybrid retrieval using embeddings, keyword/BM25, ATA classification, synonym matching, and graph links.
- Enable specialist agents to handle triage, retrieval, dispatch, procedure, wiring, parts, validation, and response generation.
- Prevent unsupported technical claims by enforcing manual authority rules and evidence validation.
- Start with a small 737NG MVP and scale across aircraft families and manual categories.
### Non-Goals
- Do not replace approved maintenance manuals, operator procedures, or regulatory decision making.
- Do not provide dispatch conclusions without MEL/MMEL evidence.
- Do not provide maintenance procedure steps without AMM, FIM, TSM, or CMM evidence.
- Do not depend on a proprietary runtime to read the knowledge bundle.
- Do not rely only on vector search for technical answers.
## 2. Problem Statement
Aircraft maintenance information is spread across many manuals and source types: QRH, MEL, AMM, FIM, WDM, SSM, IPC, CMM, training, company procedures, and source manifests. Generic RAG systems can retrieve related text but often fail to enforce which manual is authoritative for the user intent. This creates risk: the system may answer a dispatch question from training material, give a procedure without AMM evidence, mix aircraft families, or hallucinate task references.
AV-OKF solves this by making the knowledge base navigable and enforceable. The agent does not simply search; it routes, validates, and answers with source-backed constraints.

## 3. Users and Jobs To Be Done

## 4. Scope
### MVP In Scope
- Aircraft family: Boeing 737NG.
- Manual categories: QRH, MEL/MMEL, AMM, FIM/TSM, Training.
- ATA chapters: 21, 23, 24, 25, 49.
- Initial fault routes: PACK TRIP OFF, ZONE TEMP, ELT ON, ELT WILL NOT RESET, APU DOOR, GEN OFF BUS.
- Repository structure with index files, routing rules, ATA classifier, fault routes, topic pages, source manifests, and logs.
- Agent orchestration with triage, retrieval, manual authority, validation, and response roles.
- Validator for frontmatter, links, source references, authority requirements, and missing evidence.
### Later Scope
- Additional fleets: 737 MAX, 757, 767, 777, 787, A320 family.
- WDM, SSM, IPC, CMM, company manuals, reliability data, historical defect logs, and maintenance-control workflows.
- Vision extraction for diagrams, wiring, IPC illustrations, and procedure figures.
- Workflow integrations with Teams, Slack, Google Chat, WhatsApp, or internal maintenance systems.
- Admin UI for source ingestion, manual revisions, approval workflows, and audit exports.
## 5. Product Architecture
### Recommended Architecture
User Question
-> Agent Orchestrator
-> Aircraft, Effectivity, Intent, and Fault Detection
-> Hybrid Retrieval Layer
-> AV-OKF Navigation Engine
-> Specialist Agent Routing
-> Evidence Validation Layer
-> Final Answer / Action Plan / Missing Evidence Warning
### Architecture Principles
- AV-OKF is the authoritative knowledge format, not the only retrieval engine.
- Hybrid retrieval finds candidates quickly; AV-OKF navigation verifies the path.
- Manual authority rules determine what type of answer is allowed.
- Validation runs before every final answer.
- Every answer should be traceable to files, source documents, pages, and agent decisions.
## 6. Agent Integration Model
The agent layer should begin with one orchestrator and a small number of specialist roles. Avoid starting with too many agents. The MVP should implement logical roles first, even if they run inside one process.

### MVP Agent Set
- Start with Orchestrator, Triage, Retrieval, Validation, and Response agents.
- Implement Dispatch, Procedure, Wiring, and Parts as explicit modes or specialist modules after the core workflow is stable.
- Every specialist must return structured JSON plus human-readable notes.
### Agent Handoff Rules
- Triage must run before retrieval.
- Retrieval must return at least one source-backed candidate before a final answer.
- Dispatch Agent may only answer dispatch questions with MEL/MMEL evidence.
- Procedure Agent may only provide procedure guidance when AMM/FIM/CMM evidence exists.
- Validation Agent must run before the Response Agent.
- If validation fails, the final answer must state what evidence is missing instead of guessing.
### Agent Tool Contracts

## 7. Knowledge Format Requirements
### File Format
- All knowledge files must be Markdown with YAML frontmatter.
- Every directory must include an index.md file where navigation is required.
- Links must be CommonMark-compatible inline Markdown links with relative `.md` targets and must resolve inside the repository under the AV-OKF link-resolution profile.
- Each source-backed page must reference source files and source pages.
- Every aircraft-specific topic must include aircraft family, effectivity, manual type, ATA, source authority, and revision when known.
### Required File Types

## 8. Retrieval and Navigation Requirements
### Hybrid Retrieval
- Use dense embeddings for semantic matches.
- Use BM25 or keyword search for exact terms, ATA numbers, task numbers, fault messages, and acronyms.
- Use ATA classifier rules to boost likely ATA matches.
- Use synonym and alias indexes for cockpit messages, technician wording, abbreviations, and common fault phrases.
- Use graph traversal over Markdown links, typed `relations`, related_faults, related_topics, parent/child fields, and source references.
- Return confidence scores and explain why each candidate was selected.
### Navigation
- Agent starts with triage, then retrieves candidates, then uses AV-OKF indexes and routing files to validate the path.
- Agent must read manual-routing-rules.md and ata-classifier.md for the applicable aircraft family when available.
- Agent must prefer fault_route files for active fault reports.
- Agent must follow source_manifest.md to confirm source authority and revision.
- Agent must avoid mixing aircraft families unless the source explicitly supports the effectivity.
## 9. Evidence Validation and Safety Rules

### Global Safety Rules
- Do not invent manual references, source pages, task numbers, access panels, wire numbers, effectivity, or dispatch conclusions.
- If aircraft or effectivity is unknown, answer only at a general routing level and ask for the missing aircraft context.
- If required source evidence is missing, state that the bundle does not contain enough evidence.
- Separate confirmed evidence from recommended next questions.
- Training material may support explanation but cannot be used as final maintenance authority.
- Source authority and revision must be visible in the agent trace.
## 10. MVP Requirements

### MVP Test Query
Query: 737-800 ELT light on. What manual path should I use-
#### Expected behavior:
- Identify aircraft as 737NG / 737-800.
- Classify fault as ELT.
- Map ATA to 23 and 25.
- Identify intent or ask whether this is active, dispatch, troubleshooting, or procedure-related.
- Route active abnormal to QRH first.
- Route removal/install/test to AMM/CMM.
- Route dispatch question to MEL/MMEL.
- Ask targeted questions.
- Cite source files/pages from the topic/source manifest.
- Refuse unsupported dispatch or procedure claims.
## 11. User Experience Requirements
- Answer format should be concise, operational, and source-aware.
- For a fault query, show aircraft/effectivity assumption, ATA classification, manual path, evidence status, and next questions.
- For dispatch questions, clearly show whether MEL evidence exists or is missing.
- For procedure questions, provide task references when allowed, not invented procedural steps.
- Provide citations at the source-file/page level when available.
- Expose an audit or trace view for admins and reviewers.
- Make missing evidence visible instead of hiding uncertainty.
## 12. Data Model and Repository Structure
### Recommended Repository Structure
avref-knowledge/
AGENTS.md
index.md
log.md
schema/
tools/
aircraft/
737ng/
index.md
source_manifest.md
routing/
manual-routing-rules.md
ata-classifier.md
dispatch-gates.md
manuals/
amm/ mel/ qrh/ fim/ ipc/ wdm/ ssm/ cmm/ training/
ata/
ata-21-air-conditioning/
ata-23-communications/
ata-24-electrical-power/
ata-25-equipment-furnishings/
ata-49-apu/
faults/
pack-trip-off.md
zone-temp.md
elt-on.md
elt-will-not-reset.md
apu-door.md
gen-off-bus.md
traces/
### Core Metadata Fields


## 13. Non-Functional Requirements

## 14. Success Metrics


## 15. Risks and Mitigations


## 16. Release Plan

## 17. Open Questions
- Which source documents are approved for the first 737NG MVP bundle-
- Will the product initially support only routing/citations, or also direct procedure excerpts where permitted-
- What citation format is required for internal users: source file/page, task number, manual revision, or all of these-
- Should the first deployment be a local developer tool, web app, Slack/Teams bot, or API service-
- Who signs off on source authority and manual revisions-
- What permission model is required for multi-tenant airline, MRO, or internal company use-
- Should historical maintenance logs be part of MVP retrieval or later reliability analysis-
## Appendix A - Recommended Final Answer Template
Aircraft / Effectivity: <detected or missing>
Intent: <active abnormal | dispatch | troubleshooting | maintenance action | wiring | parts | training>
ATA Classification: <primary and secondary ATA with confidence>
Manual Path: <QRH/MEL/FIM/AMM/etc. with reason>
Confirmed Evidence: <source-backed findings>
Blocked / Missing Evidence: <what cannot be concluded>
Targeted Questions: <2-5 questions needed to continue>
Agent Trace ID: <trace_id>
## Appendix B - Product Moat
The moat is not AI search over PDFs. The moat is structured aviation technical knowledge plus agent routing, manual authority enforcement, source validation, effectivity awareness, audit trails, and revision-controlled knowledge bundles.

## Tables

### Table 1
| Field | Value |
| --- | --- |
| Product | AV-OKF - Aviation Open Knowledge Format for Agentic Maintenance Triage |
| Document Type | Product Requirements Document |
| Version | 1.0 |
| Date | 2026-06-30 |
| Primary Use Case | Agentic aircraft maintenance triage, manual routing, and source-backed answer generation |
| Initial Aircraft Scope | Boeing 737NG proof of concept |
| Primary Users | Hub maintenance coordinators, line maintenance technicians, maintenance control, engineering support, reliability teams |

### Table 2
| User | Jobs To Be Done | Success Looks Like |
| --- | --- | --- |
| Hub Maintenance Coordinator | Rapidly triage an aircraft fault, identify manual path, understand dispatch/procedure evidence requirements. | Gets a clear manual path, ATA mapping, missing evidence warnings, and targeted next questions. |
| Line Maintenance Technician | Find the correct AMM/FIM/WDM/IPC reference for a task, fault, part, or circuit. | Gets the correct manual category and source reference without unsupported procedural steps. |
| Maintenance Control | Evaluate repeat defects, routing direction, effectivity, and evidence needs. | Gets structured triage and validation trace for auditability. |
| Engineering / Reliability | Review recurring fault patterns and source-backed system explanations. | Gets consistent ATA/fault classification and linked source trails. |
| Training / Knowledge Manager | Create, review, version, and validate knowledge bundles. | Can maintain Markdown files, source manifests, routes, and validation reports. |

### Table 3
| Agent Role | Responsibility | Required Output |
| --- | --- | --- |
| Orchestrator Agent | Coordinates the full query workflow and calls specialist tools/agents. | Execution plan, agents/tools used, final routing decision. |
| Triage Agent | Identifies aircraft family, variant, effectivity, intent, fault terms, ATA chapter, and urgency. | Aircraft, effectivity, intent, ATA, confidence, missing inputs. |
| Retrieval Agent | Runs hybrid search and returns candidate AV-OKF files and source references. | Candidate files, source pages, confidence, selection reason. |
| Manual Authority Agent | Selects the correct manual category based on the user intent. | Allowed manual types, blocked manual types, authority rationale. |
| Dispatch Agent | Handles dispatch, defer, MEL/CDL, or can-it-fly questions. | MEL/MMEL-backed conclusion or missing-evidence block. |
| Procedure Agent | Handles remove/install/test/service/inspect/troubleshooting task references. | AMM/FIM/CMM-backed reference or missing-evidence block. |
| Wiring Agent | Handles WDM/SSM circuit, signal, connector, or power path questions. | WDM/SSM references and unresolved circuit gaps. |
| Parts Agent | Handles IPC and part identification questions. | IPC reference or missing-evidence block. |
| Validation Agent | Checks authority, effectivity, revision, citations, source pages, and unsupported claims. | Pass/fail validation report and blocked claims. |
| Response Agent | Writes the final user-facing answer. | Clear answer with confirmed facts, manual path, citations, limitations, and next questions. |

### Table 4
| Tool | Purpose | Inputs | Outputs |
| --- | --- | --- | --- |
| classify_intent | Determine user intent. | query, aircraft context | intent, confidence, missing fields |
| classify_ata | Map fault terms to ATA. | fault_terms, aircraft_family | primary_ata, secondary_ata, confidence |
| search_knowledge | Run hybrid retrieval. | query, aircraft, intent, ATA, filters | candidate files, passages, source refs, scores |
| read_topic | Open AV-OKF topic or fault file. | file_path | frontmatter, body, links, citations |
| resolve_manual_authority | Pick allowed manual types. | intent, topic, source candidates | allowed sources, blocked sources, rationale |
| validate_evidence | Check safety gates. | claims, sources, effectivity, intent | pass/fail, blocked claims, missing evidence |
| build_answer | Generate user-facing answer. | validated evidence, intent, trace | final answer, limitations, next questions |
| log_agent_trace | Persist audit trail. | query, agents, files, claims, validation | trace_id |

### Table 5
| Type | Purpose |
| --- | --- |
| aircraft_index | Aircraft family landing page. |
| manual_category | Manual category page such as AMM, MEL, QRH, or FIM. |
| ata_index | ATA chapter overview. |
| system_topic | System-level technical topic. |
| component_topic | Component-level technical topic. |
| fault_route | Fault-to-ATA/manual routing logic. |
| procedure_reference | AMM/FIM/CMM task/test/remove/install pointer. |
| dispatch_reference | MEL/MMEL item summary or dispatch gate. |
| wiring_reference | WDM/SSM signal path pointer. |
| training_reference | Training or explanation source page. |
| source_manifest | Inventory of approved source documents. |
| routing_rule | Agent routing logic. |
| change_log | Revision and change history. |

### Table 6
| Question Type | Required Evidence | Blocked Without Evidence |
| --- | --- | --- |
| Dispatch / defer / can it fly | MEL/MMEL, CDL when applicable, company dispatch rules when applicable. | Dispatchability conclusion. |
| Maintenance procedure | AMM, FIM/TSM, CMM, or approved task reference. | Procedure steps, task numbers, access panels, test instructions. |
| Troubleshooting | FIM/TSM, AMM tests, WDM/SSM if electrical. | Definitive fault isolation path. |
| Wiring / signal / connector | WDM/SSM and related AMM/FIM references. | Circuit path, connector pin, wire number claims. |
| Parts | IPC or approved parts source. | Part number or illustrated breakdown claims. |
| Training / explanation | Training/SDS/AMM system description. | Maintenance authority claim based only on training source. |

### Table 7
| ID | Requirement | Priority | Acceptance Criteria |
| --- | --- | --- | --- |
| MVP-01 | Create 737NG AV-OKF repository scaffold. | P0 | Repository includes AGENTS.md, root index, aircraft/737ng, routing, manuals, ATA, faults, schema, and source manifest. |
| MVP-02 | Implement core frontmatter schema. | P0 | `okflint validate --manifest okf-base.yaml` enforces required fields by file type, allows the typed `relations` field, and runs as a CI gate. |
| MVP-03 | Implement manual routing rules. | P0 | Agent can map intent to correct manual priority. |
| MVP-04 | Implement ATA classifier. | P0 | Initial six fault routes map to ATA chapters with confidence. |
| MVP-05 | Implement fault_route files. | P0 | Each MVP fault has manual priority, typed relation targets, source links, and targeted questions that pass the AV-OKF link-resolution profile and relation lint. |
| MVP-06 | Implement hybrid retrieval. | P0 | System retrieves candidate files using semantic, keyword, ATA, synonym, and link signals. |
| MVP-07 | Implement agent orchestration. | P0 | Triage, retrieval, authority, validation, and response roles run in sequence. |
| MVP-08 | Implement evidence validation. | P0 | Unsupported dispatch/procedure/wiring/parts claims are blocked. |
| MVP-09 | Implement agent trace log. | P1 | Each answer stores query, agents used, files read, claims, blocked claims, and final status. |
| MVP-10 | Generate source-backed answer. | P0 | Final answer includes manual path, cited evidence, limitations, and next questions. |

### Table 8
| Field | Description |
| --- | --- |
| type | Controlled file type such as fault_route, system_topic, source_manifest, or routing_rule. |
| title | Human-readable title. |
| description | Short summary for humans and agents. |
| aircraft_family | Aircraft family, e.g., 737NG. |
| aircraft_variant | Applicable variants. |
| manual_type | AMM, MEL, QRH, FIM, IPC, WDM, SSM, CMM, Training, Company. |
| ata | ATA chapter. |
| effectivity | Aircraft effectivity. |
| source_authority | maintenance, dispatch, operational, training, company, vendor. |
| revision | Manual or source revision. |
| source_file | Source document filename. |
| source_pages | Source page list. |
| task_numbers | Known task numbers where applicable. |
| relations | Typed cross-links using a controlled vocabulary such as routes_to, references, supports, covered_by, supersedes, conflicts_with, or depends_on. |
| related_faults | Linked fault route files. |
| related_topics | Linked system/component/manual files. |
| knowledge_version | Version of the knowledge object. |
| last_verified | Last review date. |

### Table 9
| Category | Requirement |
| --- | --- |
| Reliability | Validation must block unsupported high-risk claims before final response. |
| Explainability | Every final answer must be traceable to source files, source pages, and routing decisions. |
| Maintainability | Knowledge files must be readable and editable as Markdown under version control. |
| Scalability | Architecture must support additional fleets, manuals, and millions of chunks/knowledge objects. |
| Performance | MVP target: answer common fault-routing questions within a few seconds after indexing. |
| Security | Respect document permissions, tenant boundaries, and source-access controls. |
| Auditability | Persist agent trace logs for admin review and issue investigation. |
| Extensibility | Support future integrations with chat platforms, maintenance systems, source-control workflows, and manual-ingestion pipelines. |

### Table 10
| Metric | Target |
| --- | --- |
| ATA classification accuracy for MVP faults | >= 90% on curated test set. |
| Manual routing accuracy | >= 95% for known intents. |
| Unsupported dispatch/procedure claims | 0 known unblocked failures in acceptance tests. |
| Broken internal links | 0 in validated bundle. |
| Source references missing from manifest | 0 in validated bundle. |
| MVP query success rate | >= 85% for curated 737NG test queries. |
| Trace completeness | 100% of answers include trace record. |
| Reviewer confidence | Maintenance reviewer confirms answer path is explainable and source-backed. |

### Table 11
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Bad source ingestion or OCR errors | Incorrect evidence may be retrieved. | Page-level extraction QA, source manifests, validation reports, and manual reviewer approval. |
| Over-agent complexity | Slow, brittle MVP. | Start with one orchestrator and logical specialist modules. Split into separate agents only after workflow is stable. |
| Vector search retrieves wrong aircraft/manual | Unsafe answer. | Use effectivity filters, manual authority rules, and validation gate. |
| Training source used as maintenance authority | Unsupported procedure/dispatch claims. | Validation blocks training-only authority for maintenance conclusions. |
| Manual revisions change | Outdated guidance. | Knowledge versioning, source revision fields, last_verified dates, and stale-source detection. |
| Users ask vague questions | Wrong intent or aircraft assumption. | Ask targeted questions and answer only at routing level when context is missing. |

### Table 12
| Phase | Deliverables | Exit Criteria |
| --- | --- | --- |
| Phase 0 - Design | PRD, repository schema, agent contracts, validation rules. | Stakeholders approve scope and safety rules. |
| Phase 1 - Knowledge Scaffold | 737NG repo, source manifest, routing files, ATA classifier, MVP fault routes. | Validator passes for structure and links. |
| Phase 2 - Retrieval + Agents | Hybrid retrieval, orchestrator, triage, retrieval, authority, validation, response modules. | MVP test queries produce source-backed answers. |
| Phase 3 - Review Workflow | Trace logs, reviewer feedback loop, source QA, admin corrections. | Reviewer can audit and correct bundle. |
| Phase 4 - Expansion | More ATA chapters, manuals, fleets, and integrations. | System scales without weakening validation controls. |
