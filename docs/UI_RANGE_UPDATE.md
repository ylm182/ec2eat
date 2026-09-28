# Restaurant reminder and range update — 2026-09-28

- App-open visit reminder resolves the selected restaurant's current name through the existing authenticated selected-restaurant endpoint. It keeps Google attribution and never renders a place ID as a name. Missing details show a readable fallback and do not block visit confirmation. No restaurant names are persisted.
- New range choices: left 1,000 m; up 2,000 m; right 5,000 m. Buttons and react-tinder-card swipes use the same direction handler. Only the range card changes upward-swipe meaning; meal and preference questions retain their existing behavior.
- Session/input schemas also accept historical 3,000 m / 10,000 m values for compatibility. Existing explicit empty-search expansion remains unchanged; no automatic range expansion was added.

Manual acceptance:
1. Open the app with a pending previous choice: see restaurant name, not its ID; confirm visit normally.
2. Simulate missing restaurant details: see readable unavailable-name text and working visit buttons.
3. Start separate decisions with left/up/right on the range card: labels show 1/2/5 km respectively; API context and search radius match 1000/2000/5000 m.
4. Repeat via buttons, then swipe up on an ordinary preference question: it still means no preference.
5. Open an old 3/10 km history entry: it still loads.
