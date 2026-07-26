import type {
  AdaptiveEvaluationCase,
  AdaptiveEvaluationDomain,
} from "./adaptive-retrieval-evaluation.ts";

export type AdaptiveEvaluationConceptFixture = {
  body: string;
  description: string;
  filePath: string;
  page: number;
  tags: string[];
  title: string;
  type: "policy" | "procedure" | "reference";
  weakTarget: boolean;
};

export type AdaptiveEvaluationBundleFixture = {
  concepts: AdaptiveEvaluationConceptFixture[];
  description: string;
  domain: AdaptiveEvaluationDomain;
  name: string;
  rawDocument: {
    pages: Array<{ pageNumber: number; text: string }>;
    title: string;
  };
  slug: string;
};

export const ADAPTIVE_EVALUATION_BUNDLES: AdaptiveEvaluationBundleFixture[] = [
  {
    concepts: [
      concept(
        "load-stability-envelope",
        "Load Stability Envelope",
        "Approved limits for maintaining vehicle stability on slopes and uneven travel surfaces.",
        "Keep the load within the rated capacity and centered inside the stability envelope. Travel across an inclined surface only within the approved slope limit, keep the load low, and avoid unsupported edges.",
        12,
        true,
      ),
      concept(
        "stored-energy-isolation",
        "Stored Energy Isolation",
        "Approved sequence for isolating electrical and hydraulic energy before equipment service.",
        "Stop the equipment, lower attachments, disconnect the battery isolation device, discharge hydraulic accumulators, and verify a zero-energy state before service begins.",
        18,
        true,
      ),
      concept(
        "overhead-clearance-assessment",
        "Overhead Clearance Assessment",
        "Required clearance check before raising equipment or moving beneath structures.",
        "Compare the raised equipment height with the lowest overhead obstruction, including doors, pipes, lights, and cable trays. Maintain the documented clearance margin throughout movement.",
        24,
        true,
      ),
      concept(
        "equipment-readiness-policy",
        "Equipment Readiness Policy",
        "Approved pre-use policy requiring a documented readiness inspection.",
        "Operators must complete the approved readiness inspection before use. Any unresolved safety defect places the equipment out of service pending qualified review.",
        30,
        false,
        "policy",
      ),
    ],
    description: "Equipment operation and maintenance evaluation knowledge.",
    domain: "equipment_operations",
    name: "Adaptive Eval Equipment",
    rawDocument: {
      pages: [
        {
          pageNumber: 1,
          text: "Hydraulic Hose Seepage Note\nInspect hose crimps and fittings for fresh hydraulic oil, wet dust accumulation, blistering, or active seepage. Tag the equipment out of service when leakage is active.",
        },
        {
          pageNumber: 2,
          text: "Tire Sidewall Field Check\nLook for exposed cord, deep cuts, sidewall bulges, missing tread blocks, and embedded debris before equipment movement.",
        },
        {
          pageNumber: 3,
          text: "Emergency Stop Functional Test\nWith the equipment stationary and the area clear, operate the emergency stop and confirm commanded motion is inhibited before returning the control to normal.",
        },
      ],
      title: "Equipment Readiness Field Notes",
    },
    slug: "adaptive-eval-equipment",
  },
  {
    concepts: [
      concept(
        "credential-rotation-standard",
        "Credential Rotation Standard",
        "Approved requirements for replacing privileged credentials after exposure or scheduled expiry.",
        "Privileged credentials must be rotated at the defined interval and immediately after suspected disclosure. Replacement requires revoking the prior credential and verifying dependent services use the new secret.",
        11,
        true,
        "policy",
      ),
      concept(
        "privileged-session-review",
        "Privileged Session Review",
        "Approved review process for administrator and emergency-access sessions.",
        "Record the requesting identity, approved purpose, commands executed, affected systems, and reviewer outcome for every privileged or emergency-access session.",
        17,
        true,
      ),
      concept(
        "incident-containment-procedure",
        "Incident Containment Procedure",
        "Approved procedure for isolating a suspected compromised endpoint.",
        "Remove the endpoint from production network access while preserving approved forensic collection paths. Record the isolation time and do not erase volatile evidence before the incident lead authorizes collection.",
        22,
        true,
      ),
      concept(
        "security-operations-policy",
        "Security Operations Policy",
        "Approved policy requiring controlled access and documented incident handling.",
        "Security-sensitive changes require attributable access, logged review, and escalation through the documented incident process.",
        29,
        false,
        "policy",
      ),
    ],
    description: "Software security and incident response evaluation knowledge.",
    domain: "software_security",
    name: "Adaptive Eval Security",
    rawDocument: {
      pages: [
        {
          pageNumber: 1,
          text: "Secrets Inventory Observation\nThe unreviewed operations log lists service-account tokens that have no recorded owner. It recommends locating each dependent workload before revoking the token.",
        },
        {
          pageNumber: 2,
          text: "Break-Glass Account Review\nThe raw audit note says each emergency account use should be reconciled with the incident ticket, sign-in timestamp, and approving manager.",
        },
        {
          pageNumber: 3,
          text: "Endpoint Isolation Field Note\nThe response log records moving a suspected workstation into a restricted network segment while retaining access to the evidence collector.",
        },
      ],
      title: "Security Operations Field Notes",
    },
    slug: "adaptive-eval-security",
  },
  {
    concepts: [
      concept(
        "leave-carryover-policy",
        "Leave Carryover Policy",
        "Approved rules governing unused leave carried into the next benefit year.",
        "Eligible employees may carry unused leave up to the published annual limit. Amounts above that limit expire unless a documented statutory or approved exception applies.",
        10,
        true,
        "policy",
      ),
      concept(
        "workplace-accommodation-process",
        "Workplace Accommodation Process",
        "Approved process for requesting and reviewing a workplace accommodation.",
        "The employee submits the accommodation request through the designated confidential channel. The reviewer documents functional needs, evaluates reasonable options, and limits disclosure to participants who need the information.",
        16,
        true,
        "procedure",
      ),
      concept(
        "personnel-record-retention",
        "Personnel Record Retention",
        "Approved retention and disposal requirements for personnel records.",
        "Personnel records must be retained for the applicable legal and policy period, protected from unauthorized access, and disposed of through the approved confidential destruction process.",
        21,
        true,
        "policy",
      ),
      concept(
        "workplace-governance-policy",
        "Workplace Governance Policy",
        "Approved framework for consistent and confidential personnel decisions.",
        "Workplace decisions must follow published policy, preserve required confidentiality, and retain the records needed to demonstrate consistent treatment.",
        28,
        false,
        "policy",
      ),
    ],
    description: "Workplace policy and personnel operations evaluation knowledge.",
    domain: "workplace_policy",
    name: "Adaptive Eval Workplace",
    rawDocument: {
      pages: [
        {
          pageNumber: 1,
          text: "Carryover Exception Note\nThe unreviewed manager guide describes submitting an exception before the benefit-year close when scheduled operational coverage prevented an employee from using approved leave.",
        },
        {
          pageNumber: 2,
          text: "Accommodation Documentation Timing\nThe field guide asks reviewers to acknowledge a complete request within five business days and record any additional information needed.",
        },
        {
          pageNumber: 3,
          text: "Departed Employee File Note\nThe raw schedule lists separate retention periods for payroll support, performance documentation, and access acknowledgements.",
        },
      ],
      title: "Workplace Administration Notes",
    },
    slug: "adaptive-eval-workplace",
  },
  {
    concepts: [
      concept(
        "expense-exception-policy",
        "Expense Exception Policy",
        "Approved requirements for documenting and approving expenses outside normal policy.",
        "An exception request must identify the business purpose, amount, policy condition, approving authority, and supporting evidence before reimbursement.",
        9,
        true,
        "policy",
      ),
      concept(
        "invoice-reconciliation-procedure",
        "Invoice Reconciliation Procedure",
        "Approved procedure for reconciling invoices to orders, receipts, and authorized changes.",
        "Match the invoice to the purchase order, receiving evidence, and approved amendments. Investigate quantity, price, tax, or supplier discrepancies before posting.",
        15,
        true,
      ),
      concept(
        "audit-evidence-standard",
        "Audit Evidence Standard",
        "Approved standard for retaining evidence that supports financial control performance.",
        "Evidence must identify the control, period, preparer, reviewer, source population, exceptions, and final disposition. Store it in the controlled repository for the required retention period.",
        20,
        true,
        "policy",
      ),
      concept(
        "financial-controls-policy",
        "Financial Controls Policy",
        "Approved policy requiring attributable review and retained support for financial transactions.",
        "Material transactions require documented authorization, reconciliation, exception resolution, and evidence retained for audit.",
        27,
        false,
        "policy",
      ),
    ],
    description: "Finance and compliance evaluation knowledge.",
    domain: "finance_compliance",
    name: "Adaptive Eval Finance",
    rawDocument: {
      pages: [
        {
          pageNumber: 1,
          text: "Travel Exception Observation\nThe raw review note identifies missing receipts, late approval, and an undocumented business purpose as common reasons an expense exception is returned.",
        },
        {
          pageNumber: 2,
          text: "Three-Way Match Detail\nThe unreviewed accounts-payable guide compares invoice quantity and price with both the purchase order and receiving record before release.",
        },
        {
          pageNumber: 3,
          text: "Control Evidence Packaging\nThe raw audit checklist asks for the population extract, reviewer sign-off, exception list, and proof that corrective actions were closed.",
        },
      ],
      title: "Financial Control Review Notes",
    },
    slug: "adaptive-eval-finance",
  },
  {
    concepts: [
      concept(
        "vendor-onboarding-procedure",
        "Vendor Onboarding Procedure",
        "Approved procedure for establishing a supplier before purchases begin.",
        "Verify legal identity, payment details, tax documentation, sanctions screening, ownership, and approving sponsor before activating the supplier record.",
        8,
        true,
      ),
      concept(
        "facility-shutdown-procedure",
        "Facility Shutdown Procedure",
        "Approved sequence for placing a facility into a controlled shutdown state.",
        "Notify affected teams, stop active processes, isolate designated utilities, confirm critical monitoring remains available, and record the shutdown handover.",
        14,
        true,
      ),
      concept(
        "inventory-cycle-count",
        "Inventory Cycle Count",
        "Approved method for counting and reconciling selected inventory.",
        "Freeze affected movements, count independently, compare with the system quantity, investigate differences, and post only an authorized adjustment.",
        19,
        true,
      ),
      concept(
        "operational-control-policy",
        "Operational Control Policy",
        "Approved policy requiring controlled handoffs, verification, and exception records.",
        "Operational changes require a defined owner, precondition checks, recorded exceptions, and a verified handoff.",
        26,
        false,
        "policy",
      ),
    ],
    description: "General business operations evaluation knowledge.",
    domain: "general_operations",
    name: "Adaptive Eval General Operations",
    rawDocument: {
      pages: [
        {
          pageNumber: 1,
          text: "Supplier Banking Change Note\nThe unreviewed operations note requires an independent callback using a previously verified contact before changing supplier payment instructions.",
        },
        {
          pageNumber: 2,
          text: "Building Closure Handover\nThe raw checklist records utility isolation status, alarm monitoring ownership, remaining occupants, and the person accepting the closed facility.",
        },
        {
          pageNumber: 3,
          text: "Count Variance Observation\nThe field note separates recount differences caused by open movements, unit-of-measure errors, damaged stock, and incorrect storage locations.",
        },
      ],
      title: "General Operations Field Notes",
    },
    slug: "adaptive-eval-general-operations",
  },
];

export const ADAPTIVE_EVALUATION_CASES: AdaptiveEvaluationCase[] = [
  weak("equipment-load-stability", "equipment_operations", "adaptive-eval-equipment", "How should a loaded carrier avoid tipping while crossing an incline?", "concepts/procedure/load-stability-envelope.md", "sanitized_real"),
  weak("equipment-energy-isolation", "equipment_operations", "adaptive-eval-equipment", "How must technicians make residual machine power harmless before maintenance?", "concepts/procedure/stored-energy-isolation.md", "sanitized_real"),
  weak("equipment-overhead-clearance", "equipment_operations", "adaptive-eval-equipment", "What must be verified so an elevated load does not strike ceiling obstacles?", "concepts/procedure/overhead-clearance-assessment.md", "sanitized_real"),
  partial("equipment-hose-seepage", "equipment_operations", "adaptive-eval-equipment", "Give the approved equipment readiness policy with supporting raw details about wetness around fluid-line joints.", "concepts/policy/equipment-readiness-policy.md", "Equipment Readiness Field Notes", "sanitized_real"),
  partial("equipment-tire-damage", "equipment_operations", "adaptive-eval-equipment", "Give the approved equipment readiness policy with supporting raw details about damaged wheel rubber.", "concepts/policy/equipment-readiness-policy.md", "Equipment Readiness Field Notes", "sanitized_real"),
  partial("equipment-emergency-stop", "equipment_operations", "adaptive-eval-equipment", "Give the approved equipment readiness policy with supporting raw details about checking the red motion-cutoff control.", "concepts/policy/equipment-readiness-policy.md", "Equipment Readiness Field Notes", "sanitized_real"),

  weak("security-credential-rotation", "software_security", "adaptive-eval-security", "How should an exposed administrator secret be replaced and the old one withdrawn?", "concepts/policy/credential-rotation-standard.md", "synthetic"),
  weak("security-privileged-review", "software_security", "adaptive-eval-security", "How is use of a break-glass administrator login checked afterward?", "concepts/procedure/privileged-session-review.md", "synthetic"),
  weak("security-endpoint-containment", "software_security", "adaptive-eval-security", "How should a suspicious workstation be disconnected without destroying investigation material?", "concepts/procedure/incident-containment-procedure.md", "synthetic"),
  partial("security-ownerless-secrets", "software_security", "adaptive-eval-security", "Give the approved security operations policy with supporting raw details about machine credentials that have no responsible person.", "concepts/policy/security-operations-policy.md", "Security Operations Field Notes"),
  partial("security-break-glass", "software_security", "adaptive-eval-security", "Give the approved security operations policy with supporting raw details about reconciling emergency login use.", "concepts/policy/security-operations-policy.md", "Security Operations Field Notes"),
  partial("security-restricted-segment", "software_security", "adaptive-eval-security", "Give the approved security operations policy with supporting raw details about moving a suspect workstation into a limited network zone.", "concepts/policy/security-operations-policy.md", "Security Operations Field Notes"),

  weak("workplace-leave-carryover", "workplace_policy", "adaptive-eval-workplace", "What happens to remaining vacation hours when the calendar turns?", "concepts/policy/leave-carryover-policy.md", "synthetic"),
  weak("workplace-accommodation", "workplace_policy", "adaptive-eval-workplace", "How is a confidential request to alter working conditions for an employee need handled?", "concepts/procedure/workplace-accommodation-process.md", "synthetic"),
  weak("workplace-record-retention", "workplace_policy", "adaptive-eval-workplace", "How long are former worker files kept before secure destruction?", "concepts/policy/personnel-record-retention.md", "synthetic"),
  partial("workplace-carryover-exception", "workplace_policy", "adaptive-eval-workplace", "Give the approved workplace governance policy with supporting raw details about an end-of-year unused-leave exception.", "concepts/policy/workplace-governance-policy.md", "Workplace Administration Notes"),
  partial("workplace-request-timing", "workplace_policy", "adaptive-eval-workplace", "Give the approved workplace governance policy with supporting raw details about how soon a complete adjustment request is acknowledged.", "concepts/policy/workplace-governance-policy.md", "Workplace Administration Notes"),
  partial("workplace-departed-files", "workplace_policy", "adaptive-eval-workplace", "Give the approved workplace governance policy with supporting raw details about different files for a person who left the organization.", "concepts/policy/workplace-governance-policy.md", "Workplace Administration Notes"),

  weak("finance-expense-exception", "finance_compliance", "adaptive-eval-finance", "When can an employee recover money spent beyond the usual buying channel?", "concepts/policy/expense-exception-policy.md", "synthetic"),
  weak("finance-invoice-reconciliation", "finance_compliance", "adaptive-eval-finance", "How is a supplier bill checked against what was ordered and delivered?", "concepts/procedure/invoice-reconciliation-procedure.md", "synthetic"),
  weak("finance-audit-evidence", "finance_compliance", "adaptive-eval-finance", "What proof shows that a monetary safeguard was actually performed?", "concepts/policy/audit-evidence-standard.md", "synthetic"),
  partial("finance-missing-receipt", "finance_compliance", "adaptive-eval-finance", "Give the approved financial controls policy with supporting raw details about a reimbursement request returned for absent purchase proof.", "concepts/policy/financial-controls-policy.md", "Financial Control Review Notes"),
  partial("finance-three-way-match", "finance_compliance", "adaptive-eval-finance", "Give the approved financial controls policy with supporting raw details about comparing a bill with both authorization and delivery.", "concepts/policy/financial-controls-policy.md", "Financial Control Review Notes"),
  partial("finance-control-package", "finance_compliance", "adaptive-eval-finance", "Summarize the approved Financial Controls Policy and supporting raw documents about the control package population, reviewer signoff, and closed exceptions.", "concepts/policy/financial-controls-policy.md", "Financial Control Review Notes"),

  weak("operations-vendor-onboarding", "general_operations", "adaptive-eval-general-operations", "How is a new outside company established before purchasing from it?", "concepts/procedure/vendor-onboarding-procedure.md", "synthetic"),
  weak("operations-facility-shutdown", "general_operations", "adaptive-eval-general-operations", "How is a building safely closed and its remaining monitoring handed over?", "concepts/procedure/facility-shutdown-procedure.md", "synthetic"),
  weak("operations-cycle-count", "general_operations", "adaptive-eval-general-operations", "How are selected stock items checked while excluding goods still in motion?", "concepts/procedure/inventory-cycle-count.md", "synthetic"),
  partial("operations-banking-change", "general_operations", "adaptive-eval-general-operations", "Give the approved operational control policy with supporting raw details about independently confirming changed supplier payment instructions.", "concepts/policy/operational-control-policy.md", "General Operations Field Notes"),
  partial("operations-closure-handover", "general_operations", "adaptive-eval-general-operations", "Give the approved operational control policy with supporting raw details about who accepts a closed building after utilities are isolated.", "concepts/policy/operational-control-policy.md", "General Operations Field Notes"),
  partial("operations-count-variance", "general_operations", "adaptive-eval-general-operations", "Give the approved operational control policy with supporting raw details about recount differences caused by stock location or measurement errors.", "concepts/policy/operational-control-policy.md", "General Operations Field Notes"),
];

function concept(
  slug: string,
  title: string,
  description: string,
  body: string,
  page: number,
  weakTarget: boolean,
  type: AdaptiveEvaluationConceptFixture["type"] = "procedure",
): AdaptiveEvaluationConceptFixture {
  return {
    body,
    description,
    filePath: `concepts/${type}/${slug}.md`,
    page,
    tags: ["evaluation"],
    title,
    type,
    weakTarget,
  };
}

function weak(
  id: string,
  domain: AdaptiveEvaluationDomain,
  bundleSlug: string,
  query: string,
  conceptPath: string,
  origin: AdaptiveEvaluationCase["origin"],
): AdaptiveEvaluationCase {
  return {
    allowedCitationTargets: allowedTargetsForBundle(bundleSlug),
    bundleSlug,
    domain,
    expectedInitialSufficiency: "weak",
    expectedRetryEligible: true,
    expectedRoute: "okf_only",
    forbiddenCitationTargets: ["concepts/reference/retracted-decoy.md"],
    id,
    origin,
    protectedIdentifiers: [],
    query: `According to authoritative knowledge, ${lowercaseFirst(query)}`,
    requiredCitationTargets: [conceptPath],
  };
}

function allowedTargetsForBundle(bundleSlug: string): string[] {
  const fixture = ADAPTIVE_EVALUATION_BUNDLES.find(
    (bundle) => bundle.slug === bundleSlug,
  );
  if (!fixture) throw new Error(`adaptive_eval_bundle_fixture_missing:${bundleSlug}`);
  return [
    ...fixture.concepts.map((concept) => concept.filePath),
    fixture.rawDocument.title,
  ];
}

function lowercaseFirst(value: string): string {
  return value.length > 0 ? `${value[0]!.toLowerCase()}${value.slice(1)}` : value;
}

function partial(
  id: string,
  domain: AdaptiveEvaluationDomain,
  bundleSlug: string,
  query: string,
  conceptPath: string,
  rawDocumentTitle: string,
  origin: AdaptiveEvaluationCase["origin"] = "synthetic",
): AdaptiveEvaluationCase {
  return {
    allowedCitationTargets: allowedTargetsForBundle(bundleSlug),
    bundleSlug,
    domain,
    expectedInitialSufficiency: "partial",
    expectedRetryEligible: true,
    expectedRoute: "hybrid",
    forbiddenCitationTargets: ["concepts/reference/retracted-decoy.md"],
    id,
    origin,
    protectedIdentifiers: [],
    query,
    requiredCitationTargets: [conceptPath, rawDocumentTitle],
  };
}
