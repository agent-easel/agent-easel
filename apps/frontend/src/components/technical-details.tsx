import { CopyButton } from "./copy-button.tsx";
import { Disclosure } from "./disclosure.tsx";

/** One labelled raw value; rows without a value are left out. */
export type TechnicalDetail = readonly [label: string, value: string | null | undefined];

const present = (details: readonly TechnicalDetail[]) =>
  details.filter((row): row is readonly [string, string] => !!row[1]);

/** The rows as "Label: value" lines, as Copy details copies them. */
export const technicalDetailsText = (details: readonly TechnicalDetail[]) =>
  present(details)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");

/**
 * Figma RD30: raw ids, reason codes, errors and paths, collapsed until the viewer opens them, with
 * Copy details for all of it. Labelled rows read as a list; a raw error reads as one block.
 */
export function TechnicalDetails({ details }: { details: string | readonly TechnicalDetail[] }) {
  const rows = typeof details === "string" ? null : present(details);
  const text = typeof details === "string" ? details : technicalDetailsText(details);
  if (!text) return null;
  return (
    <Disclosure label="Technical details">
      <div className="flex min-w-0 flex-col gap-2 text-2xs leading-4">
        {rows ? (
          <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1.5">
            {rows.map(([label, value], index) => (
              <div key={index} className="contents">
                <dt className="text-subtle-foreground">{label}</dt>
                <dd className="min-w-0 font-mono break-all whitespace-pre-wrap text-muted-foreground">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <pre className="min-w-0 font-mono wrap-anywhere whitespace-pre-wrap text-muted-foreground">
            {text}
          </pre>
        )}
        <CopyButton text={text} label="Copy details" showLabel />
      </div>
    </Disclosure>
  );
}
