"use client";
import { useState } from "react";
import { EFB_AIRCRAFT_FAMILIES } from "@/lib/efb-aircraft-catalog";
type SelectionRegistry = {
  aircraftFamilies: Array<{ id: string; aircraftTypeIds: string[] }>;
  placements: { ataChapterIds: string[]; qrhTargetIds: string[] };
};

export function EfbSelectionFields({
  registry,
  initial,
}: {
  registry: SelectionRegistry;
  initial?: {
    aircraftTypeIds: string[];
    audiences: string[];
    aircraftFamily: string;
    ataChapter: string | null;
    qrhTargetId: string | null;
  };
}) {
  const [aircraft, setAircraft] = useState<string[]>(
      initial?.aircraftTypeIds ?? [],
    ),
    [audiences, setAudiences] = useState<string[]>(initial?.audiences ?? []),
    [family, setFamily] = useState(initial?.aircraftFamily ?? ""),
    [ataChapter, setAtaChapter] = useState(initial?.ataChapter ?? ""),
    [qrhTargetId, setQrhTargetId] = useState(initial?.qrhTargetId ?? "");
  const metadata = {
    aircraftTypeIds: aircraft,
    aircraftFamily: family,
    ataChapter: audiences.includes("maintenance") ? ataChapter : null,
    audiences,
    qrhTargetId: audiences.includes("pilot") ? qrhTargetId : null,
    effectivity: (initial as { effectivity?: string | null } | undefined)
      ?.effectivity,
  };
  const selectedFamily = registry.aircraftFamilies.find(
    (item) => item.id === family,
  );
  return (
    <>
      <label className="block">
        Aircraft family
        <select
          required
          value={family}
          onChange={(e) => {
            setFamily(e.target.value);
            setAircraft([]);
          }}
          className="block w-full rounded border bg-background p-2"
        >
          <option value="">Choose an aircraft family…</option>
          {registry.aircraftFamilies.map((item) => (
            <option key={item.id} value={item.id}>
              {familyLabel(item.id)}
            </option>
          ))}
        </select>
      </label>
      <input type="hidden" name="metadata" value={JSON.stringify(metadata)} />
      <label className="block">
        Aircraft type
        <select
          disabled={!family}
          value=""
          onChange={(e) => {
            if (e.target.value)
              setAircraft((current) => [
                ...new Set([...current, e.target.value]),
              ]);
          }}
          className="block w-full rounded border bg-background p-2"
        >
          <option value="">
            {family
              ? aircraft.length
                ? "Add another aircraft type…"
                : "Choose an aircraft type…"
              : "Choose a family first"}
          </option>
          {selectedFamily?.aircraftTypeIds.map((typeId) => (
            <option
              key={typeId}
              value={typeId}
              disabled={aircraft.includes(typeId)}
            >
              {aircraftTypeLabel(typeId)}
            </option>
          ))}
        </select>
      </label>
      <ul className="space-y-1">
        {aircraft.map((id) => (
          <li
            key={id}
            className="flex items-center justify-between gap-2 rounded border p-2 text-sm"
          >
            <span>
              {
                EFB_AIRCRAFT_FAMILIES.flatMap((item) => [...item.types]).find(
                  (type) => type.id === id,
                )?.label
              }
            </span>
            <button
              type="button"
              className="underline"
              onClick={() =>
                setAircraft((current) => current.filter((item) => item !== id))
              }
              aria-label={`Remove ${EFB_AIRCRAFT_FAMILIES.flatMap((item) => [...item.types]).find((type) => type.id === id)?.label}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        Leave aircraft type empty when the source applies to the entire selected
        family.
      </p>
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
          <p className="text-sm text-muted-foreground">
            Select pilot, maintenance, or both.
          </p>
        )}
      </fieldset>
      {audiences.includes("maintenance") && (
        <label className="block">
          Maintenance placement
          <select
            required
            value={ataChapter}
            onChange={(event) => setAtaChapter(event.target.value)}
            className="block w-full rounded border bg-background p-2"
          >
            <option value="">Choose an ATA chapter…</option>
            {registry.placements.ataChapterIds.map((id) => (
              <option key={id} value={id}>
                ATA {id}
              </option>
            ))}
          </select>
        </label>
      )}
      {audiences.includes("pilot") && (
        <label className="block">
          Pilot placement
          <select
            required
            value={qrhTargetId}
            onChange={(event) => setQrhTargetId(event.target.value)}
            className="block w-full rounded border bg-background p-2"
          >
            <option value="">Choose a QRH category…</option>
            {registry.placements.qrhTargetIds.map((id) => (
              <option key={id} value={id}>
                {formatTarget(id)}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-sm">
        The exported package is labeled as unreviewed prototype knowledge. It is
        validated for Project EFB import but is not activated automatically.
      </p>
    </>
  );
}

function familyLabel(id: string) {
  return EFB_AIRCRAFT_FAMILIES.find((item) => item.id === id)?.label ?? id;
}

function aircraftTypeLabel(id: string) {
  const type = EFB_AIRCRAFT_FAMILIES.flatMap((item) => [...item.types]).find(
    (item) => item.id === id,
  );
  return type ? `${type.label} (${type.model})` : id;
}

function formatTarget(value: string) {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
