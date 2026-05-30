require("dotenv").config();
const { Connection, PublicKey } = require("@solana/web3.js");
const fetch = require("node-fetch");

// ─── CONFIG ───────────────────────────────────────────────
const POSITION_ADDRESS = process.env.POSITION_ADDRESS;
const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.CHAT_ID || "2005545171";
const REPORT_INTERVAL_MS = 10 * 60 * 1000; // 10 menit
const RPC_URL = "https://api.mainnet-beta.solana.com";
// ──────────────────────────────────────────────────────────

if (!POSITION_ADDRESS) { console.error("❌ POSITION_ADDRESS belum diisi di .env!"); process.exit(1); }
if (!TELEGRAM_BOT_TOKEN) { console.error("❌ BOT_TOKEN belum diisi di .env!"); process.exit(1); }

const DECIMAL_DIFF = 9 - 6;
const connection = new Connection(RPC_URL, "confirmed");

async function sendTelegram(msg) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: "Markdown" }),
    });
  } catch (err) {
    console.error("Telegram error:", err.message);
  }
}

function binIdToPrice(binId, binStep) {
  return Math.pow(1 + binStep / 10000, binId) * Math.pow(10, DECIMAL_DIFF);
}

async function getPositionInfo() {
  try {
    const DLMMModule = require("@meteora-ag/dlmm");
    const DLMMClass = DLMMModule.default || DLMMModule.DLMM || DLMMModule;

    const accountInfo = await connection.getAccountInfo(new PublicKey(POSITION_ADDRESS));
    if (!accountInfo) throw new Error("Position account not found");

    const lbPairKey = new PublicKey(accountInfo.data.slice(8, 40));
    const pool = await DLMMClass.create(connection, lbPairKey);

    const positionPubkey = new PublicKey(POSITION_ADDRESS);
    const positionAccount = await pool.program.account.positionV2.fetch(positionPubkey);

    const activeBin = await pool.getActiveBin();
    const currentPrice = parseFloat(pool.fromPricePerLamport(Number(activeBin.price)));
    const binStep = pool.lbPair.binStep;

    const lowerPrice = binIdToPrice(positionAccount.lowerBinId, binStep);
    const upperPrice = binIdToPrice(positionAccount.upperBinId, binStep);
    const inRange = currentPrice >= lowerPrice && currentPrice <= upperPrice;

    const { userPositions } = await pool.getPositionsByUserAndLbPair(positionPubkey);
    let feeX = 0, feeY = 0;
    if (userPositions && userPositions.length > 0) {
      const pos = userPositions[0].positionData;
      feeX = Number(pos.feeX) / 1e9;
      feeY = Number(pos.feeY) / 1e6;
    }

    const totalFeeUsd = (feeX * currentPrice) + feeY;

    return { currentPrice, lowerPrice, upperPrice, inRange, feeX, feeY, totalFeeUsd };
  } catch (err) {
    console.error("Error:", err.message);
    return null;
  }
}

async function sendReport() {
  console.log(`[${new Date().toLocaleTimeString()}] Sending report...`);
  const data = await getPositionInfo();
  if (!data) return;

  const { currentPrice, lowerPrice, upperPrice, inRange, feeX, feeY, totalFeeUsd } = data;

  await sendTelegram(
    `💰 *Fee Update*\n\n` +
    `SOL: *$${currentPrice.toFixed(4)}*\n` +
    `Range: $${lowerPrice.toFixed(2)} - $${upperPrice.toFixed(2)} ${inRange ? "✅" : "⚠️"}\n\n` +
    `Fee terkumpul:\n` +
    `  Token X: *${feeX.toFixed(6)}*\n` +
    `  Token Y: *${feeY.toFixed(6)}*\n` +
    `  Total: *~$${totalFeeUsd.toFixed(4)}*`
  );

  console.log(`Fee: $${totalFeeUsd.toFixed(4)} | SOL: $${currentPrice.toFixed(2)} | ${inRange ? "in_range" : "out_of_range"}`);
}

async function main() {
  console.log("🚀 Meteora Fee Monitor started!");
  console.log(`📍 Position: ${POSITION_ADDRESS}`);

  await sendTelegram(`🚀 *Meteora Fee Monitor aktif!*\n📍 \`${POSITION_ADDRESS}\`\n⏱️ Update tiap 10 menit`);
  await sendReport();
  setInterval(sendReport, REPORT_INTERVAL_MS);
}

main().catch(console.error);
