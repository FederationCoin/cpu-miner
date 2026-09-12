# FederationCoin CPU miner (Electron)

Local **Electron** app: Angular UI in the renderer, Node in the main process.
Origin is `git@github.com:FederationCoin/cpu-miner.git`. Work on
`federationcoin`. Two mining modes (neither uses curl or WSL detection):

- **Node RPC** — cookie + `getblocktemplate` / `submitblock` via Node `fetch`
  to a host/port you set (default `127.0.0.1:35332`). Main reads
  `testnet3/.cookie`. The cookie never goes to the renderer. You still set a
  **tfcn1** payout; the app builds the coinbase.
- **Stratum** — ASIC-style TCP Stratum v1 (`net.Socket`). Host/port/worker
  (username) / password (default `x`). Default `127.0.0.1:23334`. A
  `.worker` suffix is allowed and not parsed specially. No payout field: the
  pool or proxy builds the coinbase. Solo still uses
  [`stratum-proxy --payout-address tfcn1…`](../cpu-miner-cpp/README.md) (or
  DATUM `mining.pool_address`); this miner only authorizes as **worker**.

Dummy **MAIN** is off. Threads stay in both modes. PoW is TypeScript
(`@noble/hashes` blake2b `dkLen: 32`) with vectors in
[`testdata/block_header_v2.json`](testdata/block_header_v2.json). Tests do not
live-grind nonces.

C++ [`cpu-miner-cpp/`](../cpu-miner-cpp/) (`fcminer` + TCP `stratum-proxy`) is
the fast CLI in the parent workspace. This app does **not** wrap those
binaries.

No Electron, Angular, or other vendor trademarks as app icons. Next pass:
**Federation Miner** robot icon, same fidelity and style as the forked
Sparrow logo. Do not copy `electron.png` / default Electron icons into git.

## Host and port

Host and port are plain TCP/HTTP. Pick values the **miner process** can open,
same as firmware. There is no OS-specific transport.

If Electron runs in a WSL GUI and the node or proxy is on Windows
`127.0.0.1`, that loopback is not Windows loopback. Set **Host** to an address
this process can route (Windows LAN IP, listen `0.0.0.0`, mirrored
networking, or run both in the same OS).

Default datadir (RPC cookie parent) follows where the miner process runs:
- Windows: `%LOCALAPPDATA%\FederationCoin`
- Linux (including WSL): `~/.federationcoin`

If the **node** is the Windows package with `-datadir G:\btc\federation-coin`,
paste `/mnt/g/btc/federation-coin` (or set `FEDERATIONCOIN_DATADIR`). Cookie is
`<datadir>/testnet3/.cookie`.

GBT still waits until the node is out of header/block sync. Wrong-PoW pools
(ckpool 80-byte SHA256d) will still `high-hash`.

## Reconnect, Help log, toasts

While **Start** is active, a dropped session is not a permanent stop. RPC
retries on `fetch` fail / ECONNREFUSED / node down after a good GBT. Stratum
retries on socket `close`/`error`. Backoff starts around 1s, doubles, and
caps at **60s**. A successful GBT or a live Stratum session (`mining.notify` or
authorized) resets the delay. **Stop** cancels the timer and does not
reconnect.

Errors and reconnects toast on the main window (few seconds). **Help >
Error log** opens a second window that tails a ring buffer in main (~500
lines). Cookie and password are not logged; worker name is fine.

## Unsigned builds (no Developer account)

We do not codesign. A vendor “Developer account” is identity-for-sale and
contradicts “don’t trust the node binary.” Anyone can fork this miner/node; if
it speaks the protocol, peers and consensus decide, not Gatekeeper or
SmartScreen. Censored OS warnings are expected. If you cannot bypass them,
don’t run it.

`electron-builder` is a **local** devDependency. Scripts produce unsigned
Linux / Windows / macOS artifacts under `dist-electron/` (gitignored). No
`npm publish`, no public Docker, no auto-update feed, no Apple Developer ID,
no Microsoft Authenticode.

```bash
npm run dist:linux
npm run dist:win
npm run dist:mac
```

CI Package (Actions → Package, human tag, draft Release) is the ship path.
Tags match `package.json` version:

```text
vMAJOR.MINOR.PATCH-federationcoin.<fork>
vMAJOR.MINOR.PATCH-federationcoin.<fork>.<ext>
```

Examples: `v0.0.0-federationcoin.0`, `v0.0.0-federationcoin.0.rc1`. Tag on
origin **before** Package. Package does not create tags. Promote the draft in
the GitHub UI. See [docs/golive-notes.md](../docs/golive-notes.md).

## Toolchain

Use **nvm** Current Node (`.nvmrc` is `node`). Angular CLI is a **local**
devDependency. Do not `npm install -g @angular/cli`. Do not use a Windows or
PATH `ng`.

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install node
nvm use
npm install
npm test
npm start
```

`npm start` builds the renderer + `out-electron/` then launches Electron.

## Rejected: in-browser + Stratum WebSocket sidecar

A page cannot call node RPC (CORS, mixed content, users pasting RPC
passwords). Sv1-over-WebSocket is only a wrap of TCP Stratum, not a standard.
A loopback WS sidecar plus pairing token would still mean installing something
local, so this app is the product. HTTPS `ws://127.0.0.1` stays mixed
content. Do not add `--ws-listen` on `stratum-proxy` for this.

## Later: a proper pool

Many miners, each sets **their own** `tfcn1`, shares scored and paid, public
stratum (`wss://` or TCP `:23334`). See
[docs/golive-notes.md](../docs/golive-notes.md). Do not vendor DATUM here.
