"use client";
import { useState } from "react";
import { EFB_AIRCRAFT_FAMILIES } from "@/lib/efb-aircraft-catalog";
export function EfbSelectionFields() {
  const [aircraft, setAircraft] = useState<string[]>([]),
    [audiences, setAudiences] = useState<string[]>([]),
    [family, setFamily] = useState(""),
    [ataChapter, setAtaChapter] = useState("");
  const metadata = {
    aircraftTypeIds: aircraft,
    aircraftFamily: family,
    ataChapter,
    audiences,
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
      <label className="block">
        ATA chapter
        <input
          required
          inputMode="numeric"
          pattern="[0-9]{2}"
          maxLength={2}
          placeholder="36"
          value={ataChapter}
          onChange={(event) => setAtaChapter(event.target.value.replace(/\D/g, "").slice(0, 2))}
          className="block w-full rounded border bg-background p-2"
        />
        <span className="mt-1 block text-sm text-muted-foreground">
          Enter the two-digit ATA chapter used to place this article in Project EFB.
        </span>
      </label>
      <fieldset className="space-y-2">
        <legend className="font-medium">Audience</legend>
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
        {audiences.length === 0 && (
          <p className="text-sm text-muted-foreground">Select pilot, maintenance, or both.</p>
        )}
      </fieldset>
      <p className="text-sm">
        The exported package is labeled as unreviewed prototype knowledge. It
        is validated for Project EFB import but is not activated automatically.
      </p>
    </>
  );
}
