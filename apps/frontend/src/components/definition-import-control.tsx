import { useRef } from "react";
import { Bot, TriangleAlert, Workflow } from "lucide-react";
import type { AgentCapabilities, FactoryProject, ImportResult } from "@t3-factory/contracts";
import { MutationGate } from "@/client-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceMenu } from "@/components/choice-menu";
import { cn } from "@/lib/utils";
import {
  importModelChoices,
  useDefinitionImport,
  type DefinitionImportModel,
  type DefinitionImportSnapshot,
  type ImportFile,
  type ImportRow,
} from "../definition-import.ts";
import { ModelOptionField } from "./execution-settings-fields.tsx";
import { NeedsModel } from "./needs-model.tsx";
import { Notice } from "./notice.tsx";
import { OwnerPicker } from "./studio-owner.tsx";
import { ownerPicker } from "../studio-definitions.ts";

/**
 * **Import** on the Flows and Agents lists: choose a `.json` file, review what it creates and
 * confirm. Either list accepts either kind of file; the file decides what is created.
 */
export function DefinitionImportControl({
  projects,
  onImported,
}: {
  /** The Project catalog offered as import targets. */
  projects: readonly FactoryProject[];
  onImported: (result: ImportResult) => void;
}) {
  const importer = useDefinitionImportChooser();
  return (
    <>
      <MutationGate>
        <Button type="button" variant="outline" onClick={importer.choose}>
          Import
        </Button>
      </MutationGate>
      <DefinitionImportDialog importer={importer} projects={projects} onImported={onImported} />
    </>
  );
}

type DefinitionImporter = ReturnType<typeof useDefinitionImportChooser>;

/** An import whose `choose` opens the file chooser that `DefinitionImportDialog` renders. */
function useDefinitionImportChooser() {
  const { model, state } = useDefinitionImport();
  const chooser = useRef<HTMLInputElement>(null);
  return { model, state, chooser, choose: () => chooser.current?.click() };
}

/**
 * The file chooser and the review of the chosen file. Render it outside a menu that opens the
 * chooser, which unmounts its content on select.
 */
function DefinitionImportDialog({
  importer: { model, state, chooser },
  projects,
  onImported,
}: {
  importer: DefinitionImporter;
  /** The Project catalog offered as import targets. */
  projects: readonly FactoryProject[];
  onImported: (result: ImportResult) => void;
}) {
  async function chosen(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (file) await model.choose({ name: file.name, text: await file.text() });
  }
  async function confirm() {
    const result = await model.confirm();
    if (result) onImported(result);
  }
  return (
    <>
      <Input
        ref={chooser}
        type="file"
        accept=".json,application/json"
        aria-label="Choose a Factory export file"
        hidden
        onChange={(event) => void chosen(event.currentTarget)}
      />
      <Dialog
        open={state.file !== null}
        onOpenChange={(open) => {
          if (!open) model.cancel();
        }}
      >
        {state.review ? (
          <ImportReviewContent
            model={model}
            state={state}
            review={state.review}
            projects={projects}
            onConfirm={() => void confirm()}
          />
        ) : (
          <ImportFileContent
            state={state}
            onCancel={model.cancel}
            onChooseAnother={() => chooser.current?.click()}
          />
        )}
      </Dialog>
    </>
  );
}

/** Blocks in the held Flow file, or null when the file is not a Flow or cannot be read. */
function importedBlockCount(file: ImportFile | null): number | null {
  if (!file) return null;
  try {
    const document = JSON.parse(file.text) as {
      flow?: { graph?: { blocks?: readonly unknown[] } };
    };
    const blocks = document.flow?.graph?.blocks;
    return Array.isArray(blocks) ? blocks.length : null;
  } catch {
    return null;
  }
}

/** Before a review answers: reading the file, or one error card when it was rejected. */
function ImportFileContent({
  state,
  onCancel,
  onChooseAnother,
}: {
  state: DefinitionImportSnapshot;
  onCancel: () => void;
  onChooseAnother: () => void;
}) {
  const rejected = !state.reviewing && Boolean(state.error);
  return (
    <DialogContent
      size="wide"
      title={<>Import “{state.file?.name}”</>}
      actions={
        <>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          {rejected && (
            <Button type="button" onClick={onChooseAnother}>
              Choose another file
            </Button>
          )}
        </>
      }
    >
      {state.reviewing && (
        <p role="status" className="text-sm text-muted-foreground">
          Reading the file…
        </p>
      )}
      {rejected && (
        <Notice
          tone="critical"
          icon={TriangleAlert}
          title="Couldn’t import this file"
          action={
            state.issues.length > 0 && (
              <ul className="list-disc pl-5">
                {state.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )
          }
        >
          {state.error}
        </Notice>
      )}
    </DialogContent>
  );
}

function ImportReviewContent({
  model,
  state,
  review,
  projects,
  onConfirm,
}: {
  model: DefinitionImportModel;
  state: DefinitionImportSnapshot;
  review: NonNullable<DefinitionImportSnapshot["review"]>;
  projects: readonly FactoryProject[];
  onConfirm: () => void;
}) {
  const { rows, capabilities, flow } = review;
  const blocked = ownerPicker(state.target, projects).blocked;
  const blocks = importedBlockCount(state.file);
  return (
    <DialogContent
      size="wide"
      closeDisabled={state.committing}
      title={<>Import “{state.file?.name}”</>}
      actions={
        <>
          {blocked && <p className="mr-auto text-sm text-destructive">{blocked}</p>}
          <Button
            type="button"
            variant="outline"
            disabled={state.committing}
            onClick={model.cancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={state.committing || !blocked ? "default" : "outline"}
            disabled={state.committing || Boolean(blocked)}
            onClick={onConfirm}
          >
            {state.committing ? "Importing…" : "Import"}
          </Button>
        </>
      }
    >
      <OwnerPicker
        kind={flow ? "Flow" : "Agent"}
        chosen={state.target}
        projects={projects}
        onChange={model.setTarget}
        disabled={state.committing}
        initial={state.target}
        hint=""
        quietStatus
      />
      <Notice
        tone="attention"
        icon={TriangleAlert}
        title="Imported prompts run with your T3 permissions"
      >
        Read them in Studio before you start a Run.
      </Notice>
      <section aria-labelledby="import-creates" className="grid gap-1.5">
        <h3 id="import-creates" className="text-2xs font-medium text-muted-foreground">
          Creates
        </h3>
        <div className="grid overflow-hidden rounded-lg border bg-background">
          {flow && (
            <div className={createsRowClass}>
              <Workflow aria-hidden className={createsIconClass} strokeWidth={1.5} />
              <p className="flex min-w-0 flex-1 items-center gap-2 leading-[normal]">
                <span className="truncate text-sm font-medium">{flow.name}</span>
                {blocks !== null && (
                  <span className="shrink-0 text-2xs text-subtle-foreground">
                    {blocks} {blocks === 1 ? "block" : "blocks"}
                  </span>
                )}
              </p>
            </div>
          )}
          {rows.map((row) => (
            <ImportModelRow
              key={row.key}
              model={model}
              row={row}
              capabilities={capabilities}
              disabled={state.committing}
            />
          ))}
        </div>
      </section>
    </DialogContent>
  );
}

/** One definition in the S01i Creates list: icon, name, and an Agent's model select at the end. */
const createsRowClass =
  "flex min-h-[46px] flex-wrap items-center gap-x-2.5 gap-y-2 py-2 pr-2 pl-3 not-first:border-t";
const createsIconClass = "size-4 shrink-0 text-muted-foreground";

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
  return (
    <div role="group" aria-labelledby={`${pickerId}-name`} className={createsRowClass}>
      <Bot aria-hidden className={createsIconClass} strokeWidth={1.5} />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Label id={`${pickerId}-name`} htmlFor={pickerId} className="text-sm font-medium">
          {row.name}
        </Label>
        {!selection && <NeedsModel />}
      </div>
      <ChoiceMenu
        id={pickerId}
        label={`Model for ${row.name}`}
        className={cn("h-7.5 w-50 shrink-0 bg-card", !selection && "border-attention")}
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
      {selection && chosenModel?.options && (
        <div className="grid basis-full grid-cols-1 gap-3 pb-1 pl-6.5 sm:grid-cols-2">
          {chosenModel.options.map((descriptor) => (
            <ModelOptionField
              key={descriptor.id}
              id={`import-option-${row.key}-${descriptor.id}`}
              label={descriptor.label}
              descriptor={descriptor}
              options={selection.modelOptions}
              onChange={(next) => model.setOption(row.key, descriptor.id, next)}
              saving={disabled}
            />
          ))}
        </div>
      )}
      {row.refusal && (
        <p role="alert" className="basis-full pl-6.5 text-xs text-destructive">
          {row.refusal}
        </p>
      )}
    </div>
  );
}
