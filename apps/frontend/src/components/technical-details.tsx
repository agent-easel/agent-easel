import { CopyButton } from "./copy-button.tsx";
import { InspectorDisclosure } from "./inspector-section.tsx";

/** One labelled raw value; rows without a value are left out. */
export type TechnicalDetail = readonly [label: string, value: string | null | undefined];

/**
 * Figma RD30: raw ids, reason codes and observation freshness, collapsed until the viewer opens
 * them, with Copy details for the whole list.
 */
export function TechnicalDetails({ details }: { details: readonly TechnicalDetail[] }) {
  const rows = details.filter((row): row is readonly [string, string] => !!row[1]);
  if (!rows.length) return null;
  return (
    <InspectorDisclosure label="Technical details">
      <div className="flex flex-col gap-2">
        <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1.5 text-2xs leading-4">
          {rows.map(([label, value], index) => (
            <div key={index} className="contents">
              <dt className="text-subtle-foreground">{label}</dt>
              <dd className="min-w-0 font-mono break-all whitespace-pre-wrap text-muted-foreground">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <CopyButton
          text={rows.map(([label, value]) => `${label}: ${value}`).join("\n")}
          label="Copy details"
          showLabel
        />
      </div>
    </InspectorDisclosure>
  );
}
