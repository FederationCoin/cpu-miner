# FederationCoin CPU miner (Electron)

Local **Federation Miner** app: Angular UI in the renderer, Node in the main process. Not Bitcoin. Experimental. No price promise.

## For users

**Testnet is the public net.** Dummy **MAIN** is not live (`mainIsLive` false). The Main tab stays enabled and toasts that MAIN is not launched; cookie/RPC failures there are expected until announcement.

Two panes share one hasher. Two mining modes:

- **Node RPC** — cookie + `getblocktemplate` / `submitblock` via Node `fetch` to a host/port you set. Testnet default `127.0.0.1:35332` and `testnet3/.cookie`, payout **tfcn1**. Main default `127.0.0.1:4094` and `<datadir>/.cookie`, payout **fcn1**. The cookie never goes to the renderer.
- **Stratum** — ASIC-style TCP Stratum v1. Host/port/worker (username) / password (default `x`). Default `127.0.0.1:23334` (saved per chain). A `.worker` suffix is allowed. No payout field: the pool or proxy builds the coinbase. Solo still uses `stratum-proxy --payout-address tfcn1…` from [`cpu-miner-cpp`](https://github.com/ldelarua/workspace-FederationCoin/tree/master/cpu-miner-cpp) (or DATUM `mining.pool_address`); this miner only authorizes as **worker**.

GPU hashing is additive and in-process. Tick GPUs in the pane (all off by default, including Intel iGPU). You do **not** run a second app or `fcminer`. You do **not** install the CUDA Toolkit. Install NVIDIA / AMD / Intel **GPU drivers** (OpenCL ICD) if you want devices listed. No driver: empty GPU list, CPU still mines. A GPU driver fault can take down the whole app. ccminer “blake2b” hashes the wrong construction.

Host and port are plain TCP/HTTP. If Electron runs in a WSL GUI and the node is on Windows `127.0.0.1`, that loopback is not Windows loopback. Set **Host** to an address this process can route.

Default datadir (RPC cookie parent):

- Windows: `%LOCALAPPDATA%\FederationCoin`
- Linux (including WSL): `~/.federationcoin`

If the **node** is the Windows package with `-datadir G:\btc\federation-coin`, paste `/mnt/g/btc/federation-coin` (or set `FEDERATIONCOIN_DATADIR`). Testnet cookie is `<datadir>/testnet3/.cookie`. Main cookie is `<datadir>/.cookie`. GBT waits until the node is out of header/block sync. Wrong-PoW pools (ckpool 80-byte SHA256d) will `high-hash`.

While **Start** is active, a dropped session retries (backoff up to 60s). **Help > Error log** tails a ring buffer. Cookie and password are not logged.

Builds are unsigned. Gatekeeper and SmartScreen may warn. If you cannot bypass them, do not run it.

Issues: [FederationCoin/cpu-miner](https://github.com/FederationCoin/cpu-miner/issues).

## For developers

Origin is `git@github.com:FederationCoin/cpu-miner.git`. Mainline is `federationcoin`. There is no upstream remote. **Never push** any registry or GitHub org that is not FederationCoin.

PoW is TypeScript (`@noble/hashes` blake2b `dkLen: 32`) with vectors in [`testdata/block_header_v2.json`](testdata/block_header_v2.json). Tests do not live-grind nonces. GPU hasher: [`native/gpu-hasher/README.md`](native/gpu-hasher/README.md). App icon is `build/icon.png` (Federation Miner). Do not copy default Electron icons into git.

The C++ CLI (`fcminer` + `stratum-proxy`) lives in the workspace dump as [`cpu-miner-cpp/`](https://github.com/ldelarua/workspace-FederationCoin/tree/master/cpu-miner-cpp). This app does **not** wrap those binaries. `private: true` so `npm publish` is refused.

### Clone and build

Use **nvm** Current Node (`.nvmrc` is `node`). Angular CLI is a **local** devDependency. Do not `npm install -g @angular/cli`.

```bash
git clone git@github.com:FederationCoin/cpu-miner.git
git checkout federationcoin
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install node
nvm use
npm install
npm test
npm start
```

`npm start` builds the renderer + `out-electron/` then the GPU addon (Electron 44 ABI) then launches Electron. If the addon fails to compile, Start still works on CPU.

Unsigned artifacts under `dist-electron/` (gitignored):

```bash
npm run dist:linux
npm run dist:win
npm run dist:mac
```

`npm run pack:win` unpacks Electron’s win32 zip without Wine. It does **not** compile a Windows `gpu-hasher.node`. Package CI runs `FC_GPU_REQUIRED=1 npm run build:gpu` on each OS runner.

### Branching

Work on a branch off `federationcoin`. Open a same-repo pull request; a human merges. Do not push straight to mainline. Current work branch: `get-to-mainnet`.

### Release

Version is `version` in `package.json`. Tags (human, on origin mainline, before Package):

```text
vMAJOR.MINOR.PATCH-federationcoin.<fork>
vMAJOR.MINOR.PATCH-federationcoin.<fork>.<ext>
```

Example: `v0.0.0-federationcoin.0`. electron-builder uses `--publish never`. Package may open a **draft** GitHub Release only. No public Docker, no auto-update feed, no Apple Developer ID, no Microsoft Authenticode. Process: [golive notes](https://github.com/ldelarua/workspace-FederationCoin/blob/master/docs/golive-notes.md).

### Quality

Code quality checks and metrics will be added over time.
