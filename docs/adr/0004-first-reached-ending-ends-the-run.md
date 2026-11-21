# The first reached ending ends the Run; Subflow results are the invoked Flow's endings

A Flow declares its intended outcomes as named endings on its one [Finish block](../../GLOSSARY.md#finish-block).
The first delivery into an ending that the Run accepts becomes the Run's one [Run result](../../GLOSSARY.md#run-result),
closes the handoff gate for good, and stops and settles the Run through the confirmed manual-settlement path, authorized
by the Flow and recorded as `finish` ([Reaching an ending](../runner.md#reaching-an-ending)). Factory stops every other
branch without asking, cancels their pending work and never returns the Run to Active. A Flow without endings, and a Run
that ends without reaching one, behaves as before.

We chose this because a Run's Settled state only describes execution: a Run that delivered a pull request and one that
gave up looked the same, and an unwired exit ended its branch without saying what that meant. One explicit result per
Run, named by the author, answers "what did this Run produce" for people, the Run views and Agents reading
`factory_get_run`. Stopping the rest at once keeps that answer final; the stop reuses the existing verified-stop
machinery instead of adding a second one.

The same ending model is the future Subflow contract. It replaces the plan recorded on
[#119](https://github.com/alimek/t3-factory/issues/119), in which an invoked Flow marked terminal exits as returns, every
marked message returned separately through one Subflow output, and a completion barrier held those returns until all of
the invocation's work, private branches included, had finished. When Subflow is built:

- the Subflow block's exits are exactly the invoked Flow's endings, keyed by ending id, so a rename keeps parent wires
  and a removed ending leaves a broken parent wire that makes the parent not ready;
- the first ending reached ends that invocation and stops only its work, and once those stops are verified Factory
  delivers the ending's name and message through the matching exit with the producing worker's provenance;
- an invocation that finishes its work without reaching an ending closes as **Nothing returned**, sends nothing and
  advances its queue; an ending reached in the parent stops running invocations;
- an invoked Flow needs at least one reachable ending.

No Subflow field is stored by the Finish block delivery.

## Implementation constraints

- The Finish block is optional: a Flow whose Runs need a result, and a Flow a Subflow invokes, adds it; any other Flow
  leaves it out. When present it counts toward the limit for authored Flows. In version-3 imports and exports, Finish
  counts when it has endings.
  Version-1 and version-2 imports and already-saved Flows can keep up to 500 ordinary Blocks. An ending delivery has its
  own target identity, so an ordinary Block with the ID `finish` keeps its wires and runtime history. Canvas selection
  and layout identify the Finish block and its ports separately from ordinary Blocks.
- Accepting a Handoff into an ending, like one at a Condition, sends nothing to T3 and commits atomically. A failed
  attempt commits nothing and leaves the Handoff pending for the next pass, so it is never noted as uncertain T3 work.
  The acceptance records the result and closes the gate in one transaction; the Runner then starts the stop-and-settle,
  also after a restart between the two commits.
- The settlement reason is `finish` once the Run reached an ending, even when a user's Settle recorded the attempt
  first. A Run with a result records its first stop attempt even when its authorization context was replaced: that
  pass cannot stop the workers and raises **Settle could not stop workers** instead of leaving the Run Active without a
  Problem.
- The result's author is the block that wrote the message. A Wait, a Condition and a Continuation pass-through forward
  an arrival's message unchanged, so the author is found by following that consecutive forwarding back to its source.
- An Agent exit wired straight to a Required ending is message-required in that Flow only. The Agent definition
  keeps its own setting. A wire to an intervening Block does not impose the ending's message requirement. Human,
  Wait and Condition outputs can reach a Required ending with blank text, which is recorded as missing.
- A Finish block nothing placed goes one layout layer gap right of the rightmost Flow input or block, level with the
  Flow input and within the canvas limits. Migration 119 removed the empty Finish blocks migration 114 had given every
  Flow revision, and format 1 and 2 imports arrive without one.

## Considered Options

- **Wait for the other branches before settling**: rejected. The Run could stay Active long after its outcome was known,
  and a late branch could contradict a result that is already shown.
- **Several results per Run, or a later report replacing the result**: rejected. Run views and `factory_get_run` would
  need ordering and versioning rules, and "the result" would no longer have one answer.
- **Return marks on terminal exits with a completion barrier (#119)**: superseded. Marks on exits split one Flow's
  outcome across Agent exits, returned several messages through one output, and let a private Human, Wait or failed
  branch hold an already selected result indefinitely. Endings give the invoked Flow and a standalone Run the same
  single, named outcome.
- **Ending outcome types or colours (success, failure)**: rejected, as [#143](https://github.com/alimek/t3-factory/issues/143)
  removed exit classification and coloured wires; the ending's name carries its meaning.

## Consequences

- Reaching an ending is hard to undo for a Run: its result is immutable, kept through Archive, and its stopped branches
  keep any edits they already made in the shared workspace without rollback.
- A racing delivery into another ending loses at the closed gate and is cancelled, never recorded as a second result.
- A Flow meant to keep its other branches running after one outcome must not wire that outcome to an ending.
- Subflow design and prototypes use ending-based exits; #119's return marks, multiple returns and completion barrier for
  results are no longer the plan.
