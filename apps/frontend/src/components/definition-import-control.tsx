import { useRef } from "react";
import { ShieldAlert, Upload } from "lucide-react";
import type {
  AgentCapabilities,
  AgentModelOptionValue,
  ImportResult,
  PortableModelHint,
} from "@t3-factory/contracts";
import { MutationGate } from "@/client-gate";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChoiceMenu } from "@/components/choice-menu";
import { optionValue } from "@t3-factory/domain-validation";
import {
  importModelChoices,
  useDefinitionImport,
  type DefinitionImportModel,
  type DefinitionImportSnapshot,
  type ImportRow,
} from "../definition-import.ts";
import { ModelOptionSelect } from "./execution-settings-fields.tsx";
import { NeedsModel } from "./needs-model.tsx";

/**
 * **Import** on a Studio list: choose a `.json` file, review what it creates and confirm. Either
 * list accepts either kind of file; the file decides what is created.
 */
export function DefinitionImportControl({
  size,
  onImported,
}: {
  size?: "sm";
  onImported: (result: ImportResult) => void;
}) {
  const { model, state } = useDefinitionImport();
  const chooser = useRef<HTMLInputElement>(null);
  async function chosen(files: FileList | null) {
    const file = files?.[0];
    if (chooser.current) chooser.current.value = "";
    if (file) await model.choose({ name: file.name, text: await file.text() });
  }
  async function confirm() {
    const result = await model.confirm();
    if (result) onImported(result);
  }
  return (
    <>
      <MutationGate>
        <Button
          type="button"
          variant="outline"
          {...(size ? { size } : {})}
          onClick={() => chooser.current?.click()}
        >
          <Upload aria-hidden strokeWidth={1.5} />
          Import
        </Button>
      </MutationGate>
      <Input
        ref={chooser}
        type="file"
        accept=".json,application/json"
        aria-label="Choose a Factory export file"
        hidden
        onChange={(event) => void chosen(event.target.files)}
      />
      <Dialog
        open={state.file !== null}
        onOpenChange={(open) => {
          if (!open) model.cancel();
        }}
      >
        <DialogContent className="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl">
          {state.review ? (
            <ImportReviewContent
              model={model}
              state={state}
              review={state.review}
              onConfirm={() => void confirm()}
            />
          ) : (
            <ImportFileContent model={model} state={state} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ImportProblem({ state }: { state: DefinitionImportSnapshot }) {
  if (!state.error) return null;
  return (
    <div role="alert" className="grid gap-1 text-sm text-destructive">
      <p>{state.error}</p>
      {state.issues.length > 1 && (
        <ul className="list-disc pl-5 text-xs">
          {state.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Before a review answers: reading the file, or why it was rejected, keeping it for a retry. */
function ImportFileContent({
  model,
  state,
}: {
  model: DefinitionImportModel;
  state: DefinitionImportSnapshot;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Import {state.file?.name}</DialogTitle>
        <DialogDescription>
          {state.reviewing ? "Reading the file…" : "Factory could not import this file."}
        </DialogDescription>
      </DialogHeader>
      <ImportProblem state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={model.cancel}>
          Cancel
        </Button>
        <Button type="button" disabled={state.reviewing} onClick={() => void model.retry()}>
          Try again
        </Button>
      </DialogFooter>
    </>
  );
}

function ImportReviewContent({
  model,
  state,
  review,
  onConfirm,
}: {
  model: DefinitionImportModel;
  state: DefinitionImportSnapshot;
  review: NonNullable<DefinitionImportSnapshot["review"]>;
  onConfirm: () => void;
}) {
  const { rows, capabilities } = review;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Review the import</DialogTitle>
        <DialogDescription>
          {rows.length === 1 ? "One new Agent" : `${rows.length} new Agents`} will be created with
          the names, prompts and exits in {state.file?.name}. Only model choices can change here.
        </DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 content-start gap-4 overflow-y-auto">
        <Alert variant="attention">
          <ShieldAlert aria-hidden />
          <AlertTitle>Imported instructions run with your T3 capabilities</AlertTitle>
          <AlertDescription>
            When you start a Run, its workers follow these Agent prompts with everything your T3
            environment allows. Importing does not start a Run; read the prompts in Studio first.
          </AlertDescription>
        </Alert>
        <section aria-labelledby="import-inventory" className="grid gap-2">
          <h3 id="import-inventory" className="text-sm font-semibold">
            Instructions in this file
          </h3>
          <ul className="grid gap-1 text-sm">
            {rows.map((row) => (
              <li key={row.key} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{row.name}</span>
                <span className="text-muted-foreground">
                  prompt {row.promptLength.toLocaleString()} characters · {row.exitCount}{" "}
                  {row.exitCount === 1 ? "exit" : "exits"}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="import-models" className="grid gap-3">
          <h3 id="import-models" className="text-sm font-semibold">
            Models
          </h3>
          {rows.map((row) => (
            <ImportModelRow
              key={row.key}
              model={model}
              row={row}
              capabilities={capabilities}
              disabled={state.committing}
            />
          ))}
        </section>
      </div>
      <div className="grid gap-3">
        <ImportProblem state={state} />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={state.committing}
            onClick={model.cancel}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm}>
            {state.committing ? "Importing…" : "Confirm import"}
          </Button>
        </DialogFooter>
      </div>
    </>
  );
}

const optionsText = (options: readonly AgentModelOptionValue[]) =>
  options.map((option) => `${option.id} ${String(option.value)}`).join(", ");

function hintText(hint: PortableModelHint): string {
  return [
    `Exported model: ${hint.modelId} on ${hint.providerInstanceId}`,
    hint.driverKind ? ` (${hint.driverKind})` : "",
    hint.modelOptions.length > 0 ? `, ${optionsText(hint.modelOptions)}` : "",
    ".",
  ].join("");
}

const matchLabel = {
  matched: "Matched",
  ambiguous: "Ambiguous",
  unmatched: "Unmatched",
  no_model: "No model in file",
} as const;

/** Why the review proposed no model for this row; nothing for a match. */
function unmatchedReason(row: ImportRow, capabilities: AgentCapabilities): string {
  const { match, hint } = row;
  if (match.status === "ambiguous") {
    const names = match.candidates.map(
      (id) =>
        capabilities.providers.find((provider) => provider.providerInstanceId === id)
          ?.displayName ?? id,
    );
    return `Several providers offer this model: ${names.join(", ")}. Choose one.`;
  }
  if (match.status !== "unmatched" || !hint) return "";
  if (capabilities.state !== "ready")
    return "Nothing was matched because the T3 catalog is unavailable.";
  return hint.driverKind
    ? `No reporting-capable ${hint.driverKind} provider here offers ${hint.modelId}.`
    : `The file names no driver kind, so only a reporting-capable provider named ${hint.providerInstanceId} offering ${hint.modelId} could match.`;
}

const choiceId = (providerInstanceId: string, modelId: string) =>
  JSON.stringify([providerInstanceId, modelId]);

function ImportModelRow({
  model,
  row,
  capabilities,
  disabled,
}: {
  model: DefinitionImportModel;
  row: ImportRow;
  capabilities: AgentCapabilities;
  disabled: boolean;
}) {
  const choices = importModelChoices(capabilities);
  const { selection } = row;
  const chosenModel = capabilities.providers
    .find((provider) => provider.providerInstanceId === selection?.providerInstanceId)
    ?.models.find((entry) => entry.id === selection?.modelId);
  const pickerId = `import-model-${row.key}`;
  const reason = unmatchedReason(row, capabilities);
  return (
    <div className="grid gap-1.5 rounded-lg border px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Label htmlFor={pickerId} className="text-sm font-medium">
          {row.name}
        </Label>
        <Badge variant={row.match.status === "matched" ? "success" : "secondary"}>
          {matchLabel[row.match.status]}
        </Badge>
        {!selection && <NeedsModel />}
      </div>
      {row.hint && <p className="text-xs text-muted-foreground">{hintText(row.hint)}</p>}
      {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
      <ChoiceMenu
        id={pickerId}
        label={`Model for ${row.name}`}
        value={selection ? choiceId(selection.providerInstanceId, selection.modelId) : ""}
        choices={[
          { id: "", label: "Needs a model" },
          ...choices.map((choice) => ({
            id: choiceId(choice.providerInstanceId, choice.modelId),
            label: choice.label,
          })),
        ]}
        onChange={(id) => {
          const [providerInstanceId, modelId] = id ? (JSON.parse(id) as [string, string]) : [];
          model.select(
            row.key,
            providerInstanceId && modelId ? { providerInstanceId, modelId } : null,
          );
        }}
        disabled={disabled}
        placeholder="Needs a model"
      />
      {selection &&
        chosenModel?.options?.map((descriptor) => {
          const id = `import-option-${row.key}-${descriptor.id}`;
          const value = optionValue(selection.modelOptions, descriptor);
          return (
            <div key={descriptor.id} className="flex items-center gap-2">
              <Label htmlFor={id} className="text-xs">
                {descriptor.label}
              </Label>
              {descriptor.type === "boolean" ? (
                <Checkbox
                  id={id}
                  checked={Boolean(value)}
                  onCheckedChange={(checked) =>
                    model.setOption(row.key, descriptor.id, checked === true)
                  }
                  disabled={disabled}
                />
              ) : (
                <ModelOptionSelect
                  id={id}
                  label={`${descriptor.label} for ${row.name}`}
                  descriptor={descriptor}
                  value={value}
                  onChange={(next) => model.setOption(row.key, descriptor.id, next)}
                  saving={disabled}
                />
              )}
            </div>
          );
        })}
      {row.droppedOptions.length > 0 && (
        <p className="text-xs text-attention">
          Dropped because the chosen model does not accept them: {optionsText(row.droppedOptions)}.
        </p>
      )}
      {choices.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {capabilities.state === "ready"
            ? "T3 offers no provider with Factory reporting; import now and choose a model later."
            : `${capabilities.explanation} Import now and choose a model in the Agent editor later.`}
        </p>
      )}
      {row.refusal && (
        <p role="alert" className="text-xs text-destructive">
          {row.refusal}
        </p>
      )}
    </div>
  );
}
