import { useId, useRef } from "react";
import { Bot } from "lucide-react";
import type { AgentCapabilities, FactoryProject, ImportResult } from "@t3-factory/contracts";
import { MutationGate } from "@/client-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceMenu } from "@/components/choice-menu";
import {
  importModelChoices,
  useDefinitionImport,
  type DefinitionImportModel,
  type DefinitionImportSnapshot,
  type ImportRow,
} from "../definition-import.ts";
import { ModelOptionField } from "./execution-settings-fields.tsx";
import {
  ImportFlowList,
  ImportInstructions,
  ImportReviewSection,
  ImportWorkspaceList,
} from "./definition-import-summary.tsx";
import { NeedsModel } from "./needs-model.tsx";
import { ProblemCard } from "./problem-card.tsx";
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
    if (file) await model.choose({ name: file.name, data: file });
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
        <ProblemCard
          density="compact"
          tone="error"
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
        </ProblemCard>
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
  const { rows, capabilities, flows } = review;
  const missingModelCard = useId();
  const { chosen, blocked } = ownerPicker(state.target, projects);
  const instructionLengths = flows.length
    ? flows.flatMap((flow) => flow.instructions.map((entry) => entry.length))
    : rows.map((row) => row.promptLength);
  const length = instructionLengths.reduce((sum, entry) => sum + entry, 0);
  const count = instructionLengths.length;
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
        kind={flows.length ? "Flow" : "Agent"}
        chosen={state.target}
        projects={projects}
        onChange={model.setTarget}
        disabled={state.committing}
        initial={state.target}
        hint=""
        quietStatus
      />
      <ProblemCard
        density="compact"
        tone="attention"
        title="Imported prompts run with your T3 permissions"
      >
        Read them in Studio before you start a Run.
        {count > 0 &&
          ` Instructions below lists all ${count.toLocaleString()} (${length.toLocaleString()} characters).`}
      </ProblemCard>
      <ImportFlowList flows={flows} owner={chosen.title} />
      <ImportWorkspaceList flows={flows} />
      {rows.some((row) => !row.selection) && (
        <p id={missingModelCard} className="sr-only">
          Choose a model here or in Studio after importing.
        </p>
      )}
      {rows.length > 0 && (
        <ImportReviewSection title={`Agents · ${rows.length} · created in ${chosen.title}`}>
          {rows.map((row) => (
            <ImportModelRow
              key={row.key}
              model={model}
              row={row}
              capabilities={capabilities}
              missingModelCard={missingModelCard}
              disabled={state.committing}
            />
          ))}
        </ImportReviewSection>
      )}
      {count > 0 && (
        <ImportInstructions flows={flows} agents={rows} count={count} length={length} />
      )}
      {state.error && (
        <ProblemCard density="compact" tone="error" title="Couldn’t import this file">
          {state.error}
          {state.issues.length > 0 && (
            <ul className="list-disc pl-5">
              {state.issues.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          )}
        </ProblemCard>
      )}
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
  missingModelCard,
  disabled,
}: {
  model: DefinitionImportModel;
  row: ImportRow;
  capabilities: AgentCapabilities;
  missingModelCard: string;
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
        className="h-7.5 w-60 max-w-full shrink-0 bg-card"
        describedBy={selection ? undefined : missingModelCard}
        value={selection ? choiceId(selection.providerInstanceId, selection.modelId) : ""}
        choices={[
          { id: "no-model", label: "Needs a model" },
          ...choices.map((choice) => ({
            id: choiceId(choice.providerInstanceId, choice.modelId),
            label: choice.label,
          })),
        ]}
        onChange={(id) => {
          const [providerInstanceId, modelId] =
            id === "no-model" ? [] : (JSON.parse(id) as [string, string]);
          model.select(
            row.key,
            providerInstanceId && modelId ? { providerInstanceId, modelId } : null,
          );
        }}
        disabled={disabled}
        placeholder="Choose a model"
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
