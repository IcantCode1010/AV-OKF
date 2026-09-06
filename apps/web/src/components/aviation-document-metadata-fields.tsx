"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Document, SourceType } from "@/lib/document-vault";

const selectClassName = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm";

type InitialValues = Pick<Document,
  | "aircraftFamilyIds"
  | "aircraftTypeIds"
  | "applicabilityScope"
  | "applicabilityStatus"
  | "classificationCode"
  | "contentPurpose"
  | "documentType"
  | "effectivity"
  | "intendedAudiences"
  | "licenseIdentifier"
  | "revision"
  | "sourceAuthority"
  | "sourceClassification"
  | "subjectFamily"
>;

export function AviationDocumentMetadataFields({
  className,
  disabled = false,
  initialSourceType = "general",
  initialValues,
  showMappedFieldsForGeneral = false,
  showApplicabilityOverride = false,
}: {
  className?: string;
  disabled?: boolean;
  initialSourceType?: SourceType;
  initialValues?: Partial<InitialValues>;
  showMappedFieldsForGeneral?: boolean;
  showApplicabilityOverride?: boolean;
}) {
  const [sourceType, setSourceType] = useState<SourceType>(initialSourceType);
  const showMapped = sourceType === "aviation" || showMappedFieldsForGeneral;
  const aviation = sourceType === "aviation";
  const classificationCode = initialValues?.classificationCode?.trim() ?? "";
  const ataCode = /^\d{2}(?:-\d{2}){0,2}$/.test(classificationCode)
    ? classificationCode
    : "";
  const sourceIdentifier = aviation && classificationCode && !ataCode
    ? classificationCode
    : "";

  return (
    <div className={className}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field htmlFor="sourceType" label="Source type">
          <select
            className={selectClassName}
            disabled={disabled}
            id="sourceType"
            name="sourceType"
            onChange={(event) => setSourceType(event.target.value as SourceType)}
            value={sourceType}
          >
            <option value="general">General</option>
            <option value="aviation">Aviation</option>
          </select>
        </Field>

        <div className={showMapped ? "contents" : "hidden"}>
          <TextField disabled={disabled || !showMapped} id="subjectFamily" label={aviation ? "Aircraft family" : "Subject family"} value={initialValues?.subjectFamily} />
          {aviation && showApplicabilityOverride ? (
            <fieldset className="space-y-4 rounded-md border border-border p-4 md:col-span-2">
              <legend className="px-1 text-sm font-medium">Aircraft applicability correction</legend>
              <label className="flex items-start gap-2 text-sm">
                <input className="mt-0.5" defaultChecked={initialValues?.applicabilityStatus === "manual_override"} disabled={disabled} name="applicabilityManualOverride" type="checkbox" value="true" />
                <span>
                  <span className="block font-medium">Use this manual applicability</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    This replaces the document-level LLM aircraft family and variant decision for future EFB releases. It does not change article ATA or audience classification.
                  </span>
                </span>
              </label>
              <div className="grid gap-4 md:grid-cols-3">
                <TextField disabled={disabled} id="aircraftFamilyIds" label="Family IDs" placeholder="737-ng" value={initialValues?.aircraftFamilyIds?.join(", ")} />
                <TextField disabled={disabled} id="aircraftTypeIds" label="Variant IDs" placeholder="B738, B739" value={initialValues?.aircraftTypeIds?.join(", ")} />
                <Field htmlFor="applicabilityScope" label="Scope">
                  <select className={selectClassName} defaultValue={initialValues?.applicabilityScope ?? "ambiguous"} disabled={disabled} id="applicabilityScope" name="applicabilityScope">
                    <option value="entire-family">Entire family</option>
                    <option value="specific-variants">Specific variants</option>
                    <option value="ambiguous">Ambiguous</option>
                  </select>
                </Field>
              </div>
            </fieldset>
          ) : (
            <TextField disabled={disabled || !showMapped || !aviation} id="aircraftTypeIds" label="Aircraft type IDs" placeholder="B738, B739" value={initialValues?.aircraftTypeIds?.join(", ")} hidden={!aviation} />
          )}
          <TextField disabled={disabled || !showMapped} id="classificationCode" label={aviation ? "ATA" : "Classification code"} placeholder={aviation ? "24 or 24-00-00" : undefined} value={aviation ? ataCode : initialValues?.classificationCode} />
          {sourceIdentifier ? (
            <TextField disabled id="sourceIdentifierDisplay" label="Source identifier" value={sourceIdentifier} />
          ) : null}
          {sourceIdentifier ? <input name="sourceIdentifier" type="hidden" value={sourceIdentifier} /> : null}
          <TextField disabled={disabled || !showMapped} id="documentType" label={aviation ? "Manual type" : "Document type"} value={initialValues?.documentType} />
          <TextField disabled={disabled || !showMapped} id="sourceAuthority" label="Source authority" value={initialValues?.sourceAuthority} />
          <TextField disabled={disabled || !showMapped} id="revision" label="Revision" value={initialValues?.revision} />
          <TextField disabled={disabled || !showMapped} id="effectivity" label="Effectivity" value={initialValues?.effectivity} />
        </div>

        <div className={aviation ? "contents" : "hidden"}>
            <Field htmlFor="sourceClassification" label="Source classification">
              <select className={selectClassName} defaultValue={initialValues?.sourceClassification ?? "unknown"} disabled={disabled || !aviation} id="sourceClassification" name="sourceClassification" required={aviation}>
                <option value="unknown">Unknown</option>
                <option value="controlled-document">Controlled document</option>
                <option value="open-reference">Open reference</option>
                <option value="training-reference">Training reference</option>
              </select>
            </Field>
            <TextField disabled={disabled || !aviation} id="licenseIdentifier" label="License identifier" placeholder="unknown" value={initialValues?.licenseIdentifier} />
            <TextField disabled={disabled || !aviation} id="contentPurpose" label="Content purpose" placeholder="technical-reference" required={aviation} value={initialValues?.contentPurpose ?? "technical-reference"} />
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Intended audiences</legend>
              <div className="flex h-9 items-center gap-5">
                {(["pilot", "maintenance"] as const).map((audience) => (
                  <label className="flex items-center gap-2 text-sm capitalize" key={audience}>
                    <input
                      defaultChecked={initialValues?.intendedAudiences?.includes(audience)}
                      disabled={disabled || !aviation}
                      name="intendedAudiences"
                      type="checkbox"
                      value={audience}
                    />
                    {audience}
                  </label>
                ))}
              </div>
            </fieldset>
        </div>
      </div>
    </div>
  );
}

function Field({ children, htmlFor, label }: { children: React.ReactNode; htmlFor: string; label: string }) {
  return <div className="space-y-2"><Label htmlFor={htmlFor}>{label}</Label>{children}</div>;
}

function TextField({ hidden, id, label, value, ...props }: {
  hidden?: boolean;
  id: string;
  label: string;
  value?: string | null;
} & Omit<React.ComponentProps<typeof Input>, "defaultValue" | "value">) {
  return <div className={hidden ? "hidden" : "space-y-2"}><Label htmlFor={id}>{label}</Label><Input defaultValue={value ?? ""} id={id} name={id} {...props} /></div>;
}
