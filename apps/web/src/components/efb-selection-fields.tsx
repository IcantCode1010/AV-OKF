"use client";
import { useState } from "react";
import { EFB_AIRCRAFT_FAMILIES } from "@/lib/efb-aircraft-catalog";
export function EfbSelectionFields() {
  const [aircraft, setAircraft] = useState<string[]>([]),
    [audiences, setAudiences] = useState<string[]>([]),
    [ata, setAta] = useState(""),
    [license, setLicense] = useState(""),
    [attribution, setAttribution] = useState("");
  const [family, setFamily] = useState(""),
    [effectivity, setEffectivity] = useState("");
  const metadata = {
    aircraftTypeIds: aircraft,
    aircraftFamily: family,
    effectivity,
    audiences,
    placements: ata ? [`ata:${ata}:0`] : [],
    authority:
      "Educational reference — not approved operating or maintenance instructions",
    license,
    attribution,
  };
  return (
    <>
      <label className="block">
        Aircraft family
        <select
          required
          value={family}
          onChange={(e) => { setFamily(e.target.value); setAircraft([]); }}
          className="block w-full rounded border bg-background p-2"
        >
          <option value="">Choose an aircraft family…</option>
          {EFB_AIRCRAFT_FAMILIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label className="block">
        Applicable configuration / effectivity
        <input
          required
          value={effectivity}
          onChange={(e) => setEffectivity(e.target.value)}
          className="block w-full rounded border bg-background p-2"
        />
      </label>
      <input type="hidden" name="metadata" value={JSON.stringify(metadata)} />
      <label className="block">
        Aircraft type
        <select
          required={aircraft.length === 0}
          disabled={!family}
          value=""
          onChange={(e) => { if (e.target.value) setAircraft((current) => [...new Set([...current, e.target.value])]); }}
          className="block w-full rounded border bg-background p-2"
        >
          <option value="">{family ? (aircraft.length ? "Add another aircraft type…" : "Choose an aircraft type…") : "Choose a family first"}</option>
          {EFB_AIRCRAFT_FAMILIES.find((item) => item.id === family)?.types.map((type) =>
            <option key={type.id} value={type.id} disabled={aircraft.includes(type.id)}>{type.label} ({type.model})</option>)}
        </select>
      </label>
      <ul className="space-y-1">
        {aircraft.map((id) => <li key={id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
          <span>{EFB_AIRCRAFT_FAMILIES.flatMap((item) => [...item.types]).find((type) => type.id === id)?.label}</span>
          <button type="button" className="underline" onClick={() => setAircraft((current) => current.filter((item) => item !== id))} aria-label={`Remove ${EFB_AIRCRAFT_FAMILIES.flatMap((item) => [...item.types]).find((type) => type.id === id)?.label}`}>Remove</button>
        </li>)}
      </ul>
      <p className="text-sm text-muted-foreground">Choose only the variants supported by the article’s sources. This list shows aircraft currently supported by EFB; selecting a family does not select every variant.</p>
      <div className="flex gap-4">
        {["pilot", "maintenance"].map((a) => (
          <label key={a}>
            <input
              type="checkbox"
              checked={audiences.includes(a)}
              onChange={(e) =>
                setAudiences(
                  e.target.checked
                    ? [...audiences, a]
                    : audiences.filter((x) => x !== a),
                )
              }
            />{" "}
            {a}
          </label>
        ))}
      </div>
      <label className="block">
        ATA chapter
        <input
          required
          value={ata}
          onChange={(e) => setAta(e.target.value)}
          placeholder="24"
          className="block w-full rounded border bg-background p-2"
        />
      </label>
      <label className="block">
        Permitted-use / license identifier
        <input
          required
          value={license}
          onChange={(e) => setLicense(e.target.value)}
          className="block w-full rounded border bg-background p-2"
        />
      </label>
      <label className="block">
        Source attribution
        <input
          required
          value={attribution}
          onChange={(e) => setAttribution(e.target.value)}
          className="block w-full rounded border bg-background p-2"
        />
      </label>
      <p className="text-sm">
        Selecting confirms these publication details for this educational
        revision. It does not publish to EFB.
      </p>
    </>
  );
}
