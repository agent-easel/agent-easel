# The shared canvas draws only what reaches the view

The Flow editor and the Run canvas share one surface. It draws the blocks whose frames, and the wires whose paths, reach a
window: the part of the graph the view shows plus half a view beyond each edge. The window is kept while the view stays
inside it, so panning draws nothing new until the view leaves it, and it is replaced when zooming in leaves it more than four
times the view. Fit Flow draws every block, since every block is then in view. The Flow input and Finish always draw, as do a
block that has keyboard focus, a selected wire in Studio, and the blocks a drag or a connection gesture holds, so a gesture or
a key press never loses its element when the view moves.

Layout and wire geometry never depend on what is drawn. Block frames, ports, wire paths and the bounds that decide whether a
wire reaches the window are computed from the whole graph, as is the view that Fit, entry and Follow active choose. A block that
returns to view, and a wire crossing the view between two blocks that are both away, sit exactly where an unculled canvas would
put them. Wire paths and canvas geometry are memoized per graph and reused while the view moves or a block is selected, and
block card content is built only for mounted blocks while block footer heights stay computed for the whole graph.

Connection indexes are built in one pass over the connections. The canvas graph reads each block's wired exits from such an
index, as the incoming ports and exit rows already did, where a scan of every connection per block made its cost grow with blocks
times connections.

We chose this because a Flow may hold 500 blocks and 5,000 connections. Drawing all of them left pan frames above 60 ms and a
Follow from a zoomed-out view above 100 ms on a developer machine, since each frame repaints thousands of SVG paths and hundreds of
blocks. Drawing what the view reaches keeps frame time with the visible part, whatever the size of the Flow.

The cost is that blocks away from the view are not in the page. Assistive technology and keyboard focus reach the blocks near the
view; the canvas itself takes the arrow keys to pan, and **Fit Flow** draws every block. A native find-in-page does not match the
text of a block that is away.

We tried shrinking an oversized window gradually, and keeping it large until the view rests. Neither gave smoother frames: the
cost of a Follow from a zoomed-out view is the number of blocks and wires drawn while zoomed out, and not how a window shrinks.

A browser journey compares wire geometry before and after a block leaves and returns to view. Timings on 500 blocks and 5,000
connections are measured by hand and recorded in the pull request; no automated check asserts a time.
