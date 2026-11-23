import "./style.css";
import "./bg";
import {
  createPublicClient, createWalletClient, custom, http, defineChain, keccak256, encodeFunctionData,
  formatUnits, parseUnits, parseAbi, type Address, type Hex,
} from "viem";
import {
  ArlV5PoolClient, arlV5PoolAbi, giwaSepoliaAutoRoute, TAMM_GIWA_SEPOLIA_WETH, TAMM_TOKEN_DECIMALS,
  type ArlV5Deployment,
} from "@ammora-protocol/sdk";

// ---- GIWA Sepolia (91342): endpoints from the SDK's chain catalog ----
const sdkChain = (giwaSepoliaAutoRoute as unknown as { chain?: { rpcUrls?: string[]; blockExplorerUrl?: string } }).chain;
const RPC = sdkChain?.rpcUrls?.[0] ?? "https://sepolia-rpc.giwa.io";
const EXPLORER = (sdkChain?.blockExplorerUrl ?? "https://sepolia-explorer.giwa.io").replace(/\/$/, "");
const CHAIN_ID = 91342;
const chain = defineChain({
  id: CHAIN_ID, name: "GIWA Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: "GIWA Explorer", url: EXPLORER } },
  testnet: true,
});

// ---- tAMM market: graduated curve -> public ARL V5 pool (curve.canonicalPool, read on-chain) ----
const TAMM = "0x10B3Cc2fc981277Ada576891CF649D0ABA768B06" as Address;
const WETH = TAMM_GIWA_SEPOLIA_WETH as Address;
const POOL = "0x1EF92A6a9BB4bBed2b385Dd5E688F88e7965BCf8" as Address;
const PINS: Record<string, [Address, bigint]> = {
  factory: ["0xC0Fc168DeD39DA53C11D5082D9303216C3c37375", 36388500n],
  implementation: ["0x13bF46FF9d0aEc90f32766205859117475b0FA1C", 36388500n],
  controller: ["0x4Dd884649Fb2DAB27B918cd3e875Cf934a6fFc78", 36388505n],
  vault: ["0x1D296F4cf59B378414ba347bd20bAE49B0DfF04c", 36388500n],
  tokenPolicy: ["0xcD2b401124cc3C01998147CfB0F52111c2ac7611", 36388476n],
  feePolicy: ["0x268E008734335411816739c5c3091bbF61eD3641", 36388482n],
};

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const wethAbi = parseAbi(["function deposit() payable", "function withdraw(uint256)"]);

const pub = createPublicClient({ chain, transport: http(RPC) });
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  connect: $<HTMLButtonElement>("connect"), net: $("net"), acct: $("acct"), amt: $<HTMLInputElement>("amt"),
  balIn: $("balIn"), balOut: $("balOut"), symIn: $("symIn"), symOut: $("symOut"), out: $("out"),
  flip: $("flip"), max: $("max"), slip: $<HTMLSelectElement>("slip"), info: $("info"),
  go: $<HTMLButtonElement>("go"), status: $("status"),
};

type EIP1193 = { request(a: { method: string; params?: unknown[] }): Promise<unknown>; on?(e: string, f: () => void): void };
const eth = (window as unknown as { ethereum?: EIP1193 }).ethereum;
let account: Address | undefined;
let onChain = false;
let buyingTamm = true; // true: ETH -> tAMM
let balEth = 0n, balTamm = 0n;
let quoteOut: bigint | undefined;
let busy = false;
let quoteSeq = 0;

const fmt = (v: bigint, d: number, max = 6) => {
  const [i, f = ""] = formatUnits(v, d).split(".");
  const frac = f.slice(0, max).replace(/0+$/, "");
  return frac ? `${i}.${frac}` : i;
};
const link = (hash: Hex) => `<a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noopener">${hash.slice(0, 10)}...${hash.slice(-6)}</a>`;
const setStatus = (html: string, cls = "") => {
  el.status.className = "status " + (cls || (html ? "wait" : ""));
  el.status.innerHTML = html;
  if (cls) { void el.status.offsetWidth; el.status.classList.add("pop"); } // restart animation
};
const restart = (node: HTMLElement, cls: string) => { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); };
const errMsg = (e: unknown) => String((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? e).slice(0, 300);

const dIn = () => (buyingTamm ? 18 : TAMM_TOKEN_DECIMALS);
const dOut = () => (buyingTamm ? TAMM_TOKEN_DECIMALS : 18);

function parseAmount(): bigint | undefined {
  const t = el.amt.value.trim().replace(",", ".");
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return undefined;
  try { const v = parseUnits(t, dIn()); return v > 0n ? v : undefined; } catch { return undefined; }
}

async function buildDeployment(): Promise<ArlV5Deployment> {
  // The SDK ships no V5 catalog, so runtime hashes are read from the chain (trust-on-first-use).
  const contracts: Record<string, { address: Address; startBlock: bigint; runtimeCodeHash: Hex }> = {};
  for (const [role, [address, startBlock]] of Object.entries(PINS)) {
    const code = await pub.getCode({ address });
    if (!code) throw new Error(`No code at ${role}`);
    contracts[role] = { address, startBlock, runtimeCodeHash: keccak256(code) };
  }
  return {
    schemaVersion: 1, abiVersion: "arl-public-v5.1", chainId: CHAIN_ID, revision: "local-tamm-v5",
    contracts, capabilities: { version: 1, revision: "1", mode: "active", actions: ["swap"], reason: "swap-only app" },
  } as unknown as ArlV5Deployment;
}
let poolClient: Promise<ArlV5PoolClient> | undefined;
const getPoolClient = () => (poolClient ??= buildDeployment().then((d) => new ArlV5PoolClient(pub, d, POOL)));

async function refreshBalances() {
  if (!account) { el.balIn.textContent = "Balance: -"; el.balOut.textContent = "Balance: -"; return; }
  [balEth, balTamm] = await Promise.all([
    pub.getBalance({ address: account }),
    pub.readContract({ address: TAMM, abi: erc20, functionName: "balanceOf", args: [account] }),
  ]);
  const e = `${fmt(balEth, 18)} ETH`, t = `${fmt(balTamm, TAMM_TOKEN_DECIMALS)} tAMM`;
  el.balIn.textContent = "Balance: " + (buyingTamm ? e : t);
  el.balOut.textContent = "Balance: " + (buyingTamm ? t : e);
}

async function updateQuote() {
  const seq = ++quoteSeq;
  const amount = parseAmount();
  quoteOut = undefined; el.out.textContent = "0.0"; el.info.textContent = "";
  el.out.classList.toggle("skel", !!amount);
  if (amount) {
    try {
      // Read-only call with the SDK's pool ABI; needs no wallet.
      const q = await pub.readContract({ address: POOL, abi: arlV5PoolAbi, functionName: "quoteExactIn", args: [buyingTamm ? WETH : TAMM, amount] }) as bigint;
      if (seq !== quoteSeq) return;
      quoteOut = q; el.out.classList.remove("skel"); el.out.textContent = fmt(q, dOut(), 8); restart(el.out, "tick");
      const bps = BigInt(el.slip.value);
      el.info.textContent = `Min received at ${Number(bps) / 100}% slippage: ${fmt(q * (10000n - bps) / 10000n, dOut(), 8)} ${buyingTamm ? "tAMM" : "ETH"}`;
    } catch (e) { if (seq === quoteSeq) { el.out.classList.remove("skel"); el.info.textContent = "Quote unavailable: " + errMsg(e); } }
  }
  updateButton();
}

function updateButton() {
  const amount = parseAmount();
  let label = "Swap", ok = false, actionable = false;
  if (!eth) label = "No wallet found";
  else if (!account) { label = "Connect wallet"; actionable = true; }
  else if (!onChain) { label = "Switch to GIWA Sepolia"; actionable = true; }
  else if (!amount) label = "Enter an amount";
  else if (amount > (buyingTamm ? balEth : balTamm)) label = `Insufficient ${buyingTamm ? "ETH" : "tAMM"}`;
  else if (!quoteOut) label = "No quote";
  else { ok = true; label = buyingTamm ? "Swap ETH for tAMM" : "Swap tAMM for ETH"; }
  el.go.disabled = busy || !(ok || actionable);
  el.go.textContent = busy ? "Working..." : label;
  el.go.classList.toggle("loading", busy);
}

async function switchChain() {
  const hexId = "0x" + CHAIN_ID.toString(16);
  try { await eth!.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] }); }
  catch (e) {
    if ((e as { code?: number }).code === 4902 || /unrecognized|not added/i.test(errMsg(e))) {
      await eth!.request({ method: "wallet_addEthereumChain", params: [{
        chainId: hexId, chainName: "GIWA Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: [RPC], blockExplorerUrls: [EXPLORER] }] });
    } else throw e;
  }
}

async function syncWallet(request = false) {
  if (!eth) { updateButton(); return; }
  if (request) el.connect.classList.add("loading");
  try {
    const accs = await eth.request({ method: request ? "eth_requestAccounts" : "eth_accounts" }) as string[];
    account = accs[0] as Address | undefined;
    const cid = parseInt(await eth.request({ method: "eth_chainId" }) as string, 16);
    onChain = cid === CHAIN_ID;
    el.net.textContent = account ? (onChain ? "GIWA Sepolia" : `Wrong network (${cid})`) : "Not connected";
    el.acct.textContent = account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "";
    el.connect.textContent = account ? "Connected" : "Connect wallet";
    if (account && onChain) await refreshBalances();
  } catch (e) { setStatus(errMsg(e), "err"); }
  el.connect.classList.remove("loading");
  updateButton();
}

async function send(wallet: ReturnType<typeof createWalletClient>, label: string, tx: { to: Address; data: Hex; value?: bigint }) {
  setStatus(`${label}: confirm in wallet...`);
  const hash = await wallet.sendTransaction({ account: account!, chain, to: tx.to, data: tx.data, value: tx.value ?? 0n });
  setStatus(`${label}: pending ${link(hash)}`);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} failed: ${hash}`);
  setStatus(`${label}: confirmed ${link(hash)}`, "ok");
  return hash;
}

async function doSwap() {
  const amount = parseAmount();
  if (!amount || !account || !eth) return;
  busy = true; updateButton();
  try {
    const wallet = createWalletClient({ account, chain, transport: custom(eth) });
    const pc = await getPoolClient();
    const slippageBps = Number(el.slip.value);
    const wethBal = () => pub.readContract({ address: WETH, abi: erc20, functionName: "balanceOf", args: [account!] });

    if (buyingTamm) {
      const have = await wethBal();
      if (have < amount) {
        await send(wallet, "Wrap ETH", { to: WETH, value: amount - have, data: encodeFunctionData({ abi: wethAbi, functionName: "deposit" }) });
      }
    }
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const plan = await pc.planSwapExactIn({ caller: account, recipient: account, token: buyingTamm ? WETH : TAMM, amount, slippageBps, deadline });
    for (const t of plan.approval.transactions) await send(wallet, "Approve", t);
    const wethBefore = buyingTamm ? 0n : await wethBal();
    const hash = await send(wallet, "Swap", plan.transaction);
    if (!buyingTamm) {
      const got = (await wethBal()) - wethBefore;
      if (got > 0n) await send(wallet, "Unwrap WETH to ETH", { to: WETH, data: encodeFunctionData({ abi: wethAbi, functionName: "withdraw", args: [got] }) });
    }
    setStatus(`<span class="check" aria-hidden="true"></span>Swap done ${link(hash)}`, "ok");
    el.amt.value = "";
  } catch (e) { setStatus(errMsg(e), "err"); }
  busy = false;
  await refreshBalances().catch(() => {});
  await updateQuote();
}

el.connect.onclick = () => syncWallet(true);
el.go.onclick = async () => {
  if (!eth) return setStatus("Install an injected wallet (e.g. MetaMask).", "err");
  if (!account) return syncWallet(true);
  if (!onChain) { try { await switchChain(); } catch (e) { setStatus(errMsg(e), "err"); } return syncWallet(); }
  return doSwap();
};
el.flip.onclick = () => {
  el.flip.classList.toggle("spun");
  document.querySelectorAll<HTMLElement>(".box").forEach((b) => restart(b, "swapping"));
  buyingTamm = !buyingTamm;
  el.symIn.textContent = buyingTamm ? "ETH" : "tAMM";
  el.symOut.textContent = buyingTamm ? "tAMM" : "ETH";
  el.amt.value = "";
  refreshBalances().catch(() => {});
  updateQuote();
};
el.max.onclick = () => {
  const bal = buyingTamm ? (balEth > 10n ** 15n ? balEth - 10n ** 15n : 0n) : balTamm; // keep 0.001 ETH for gas
  el.amt.value = formatUnits(bal, dIn());
  updateQuote();
};
let timer: number | undefined;
el.amt.oninput = () => { clearTimeout(timer); timer = window.setTimeout(updateQuote, 250); updateButton(); };
el.slip.onchange = updateQuote;
eth?.on?.("accountsChanged", () => syncWallet());
eth?.on?.("chainChanged", () => syncWallet());
syncWallet();
updateQuote();
