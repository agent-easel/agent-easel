# Share Flow canvas geometry with Auto-arrange

Studio Auto-arrange and backend authoring use the same graph and geometry in ELK. The layout
runs without a browser or changes to the input graph, so the backend can supply missing positions
and both consumers can use the result. The [Studio contract](../studio.md#automatic-layout-and-canvas-view)
describes when positions and routes change.

ELK anchors wires at the canvas's actual exit rows, including unavailable endpoints of saved
wires. A crowded input side grows the block height and keeps its existing exit anchors fixed,
so adding an incoming wire preserves the geometry of outgoing wires. The shared calculation
reserves label space with a conservative width derived from the label length and padding. That
keeps layout independent of browser font measurement.

The layout traverses reachable blocks from the Flow input in reverse depth-first finishing
order, then covers disconnected blocks. With ELK's model-order cycle breaking, this favors
left-to-right paths and routes correction edges back left. ELK's Flow input node and user
block nodes occupy distinct ID namespaces. Incoming ports index the source of each wire once
per graph to avoid rescanning connections for each anchor. A structured key preserves distinct
source and exit IDs even when those IDs contain delimiters.

A Condition may hold tens of thousands of rules within the definition limit. Rendering every
unwired output would make a block too tall to use. The canvas keeps Otherwise, every wired
rule and a bounded set of unwired rules. The panel can still edit every rule.
