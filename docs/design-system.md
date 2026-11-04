# Design system

The web app's look is defined in one place: [`frontend/src/tokens.css`](../frontend/src/tokens.css).
Components in [`frontend/src/index.css`](../frontend/src/index.css) read only those tokens, so a
colour or font changes everywhere by editing one line.

## Layout

A split view. Your links are always on the left (search, status filters, click count and a
12-point sparkline per link); the selected link fills the right. Creating a link is a composer
opened with **N** or **Ctrl/⌘ K** from anywhere; pasting several lines creates them in bulk. On
phones the two panes become two screens: the list, then the link.

## Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `app` / `rail` / `card` | `#fbfbfa` / `#f3f3f1` / `#ffffff` | `#0e1014` / `#0a0c0f` / `#15181e` | Workspace, links sidebar, panels |
| `ink` / `muted` / `faint` | `#121212` / `#63635f` / `#84847e` | `#e9ebef` / `#9aa1ad` / `#6e7581` | Text, secondary text, sparklines and axis labels |
| `primary` / `on-primary` | `#121212` / `#ffffff` | `#e9ebef` / `#0e1014` | The main action: New link, Copy, Create |
| `accent` / `accent-soft` | `#1b55e8` / `#eaf0ff` | `#86a8ff` / `#1b2542` | Data only: the clicks chart, the selected link's sparkline, focus rings |
| `ok` · `warn` · `bad` | green · amber · red | lighter in dark | Active · Expired · errors and Delete, always with a word |

Actions are near-black; blue is reserved for data so the chart is the one coloured thing on the
screen. QR codes always sit on white so they scan in dark mode. Every text pair holds 4.5:1
contrast in both themes; borders that mark a control and the faint data greys hold 3:1.

## Type

- **Instrument Sans** for interface text.
- **IBM Plex Mono** for anything you copy or compare: short codes, URLs in the composer and
  click counts (tabular figures, so numbers line up).

## The clicks chart

A route line: the clicks per hour (or day) as a 3.5 px blue line over a pale fill, with hollow
stops every third point, a large filled stop at the busiest point and a filled stop at "now".
Missing buckets are filled with zero so the axis stays continuous; a period with no clicks says
so in words.

## Writing

Plain and short: "New link", "Create link", "Copy", "✓ Available", "Alias already taken". Errors
say what happened and how to fix it. No visitor data is collected, and the link page says so.
