# Demo video script

Target length: 2-3 minutes. Six browser tabs, one screen recording, no
cuts inside a beat unless noted.

## Setup (before recording)

- Six browser tabs open side by side, or a 3x2 grid capture, each
  pointed at the local client (`npm run dev`).
- Devnet wallets funded, program deployed, `.env` pointed at devnet ER.
- Have `solana logs` or the ER explorer open in a spare tab for the
  reveal beat.

## Shot list

**0:00-0:15 — Cold open, pitch line**
Screen: title card or the lobby screen, empty.
VO: "This is Rugged. Among Us, on Solana. One player is secretly the
Rugger, and here's the twist: not even the chain knows who, until the
game is over."

**0:15-0:35 — Join**
Screen: six tabs, each typing a distinct ticker (`$RUG`, `$MOON`,
`$WAGMI`, `$APE`, `$DEGEN`, `$PUMP`) and hitting join. Lobby counter
ticks up to 6/6.
VO: "Six players join with a memecoin ticker. Once the lobby fills, the
game assigns one Rugger."

**0:35-0:55 — Role assignment + hash reveal**
Screen: cut to the chain explorer tab, show the `assign_roles`
transaction and the committed hash bytes. Zoom on the hash.
VO: "Assignment posts a hash of the role and a secret salt, on chain.
The role itself never touches the chain in the clear. That's the
commit; the reveal comes at the end."

**0:55-1:10 — Delegate + first moves**
Screen: tabs show a short "delegating…" beat, then the map appears.
Move two or three players between rooms quickly, positions updating
across tabs in real time.
VO: "The game delegates to a MagicBlock Ephemeral Rollup. Every move
lands in under fifty milliseconds."

**1:10-1:30 — The rug**
Screen: Rugger tab and a victim tab share a room. Rugger clicks "rug."
Victim tab shows an elimination screen; other tabs show a "player
down" notice.
VO: "The Rugger strikes when adjacent, on a cooldown. One player is
down."

**1:30-1:55 — Meeting and vote**
Screen: a surviving tab calls a meeting; all tabs snap to the vote
screen. Show two or three tabs casting votes on different suspects,
then the vote count populate.
VO: "Any survivor can call a meeting. The crew votes, and majority
rules."

**1:55-2:15 — Slash and resolution**
Screen: `resolve_meeting` fires, the accused tab shows elimination.
If it's the Rugger: crew-win banner. If not: game continues one beat,
then cut to a second, faster meeting/vote/slash that does land the
Rugger, to keep this beat inside its time box.
VO: "Guess right, and the crew wins. Guess wrong, and the Rugger keeps
rugging until the crew's down to parity."

**2:15-2:35 — Win screen + on-chain reveal**
Screen: win screen shows the Rugger's ticker and role, side by side
with the original committed hash from 0:35. Cut to the explorer tab
showing `end_game`: role revealed, accounts undelegated back to base
layer.
VO: "At game end, the role reveals, the hash checks out, and the game
settles back to Solana."

**2:35-2:50 — Close**
Screen: architecture diagram from the README (base layer / ER split),
held for a beat.
VO: "Rugged: hidden roles, real-time play, all in one Ephemeral
Rollup. Built for MagicBlock Solana Blitz V7."

## Notes for the editor

- Keep every on-chain beat (hash commit, reveal) on screen at least 3
  seconds; that's the whole pitch, don't rush it.
- If timing runs long, cut the second meeting/vote cycle at 1:55 and
  let the first vote resolve the game either way; adjust VO to match
  whichever outcome recorded.
- Captions should spell out the hash bytes once, briefly, so the
  "not even the chain knows" claim is visibly true, not just asserted.
