require("dotenv").config();
const { Connection, PublicKey } = require("@solana/web3.js");
const fetch = require("node-fetch");

// ─── CONFIG dari .env ─────────────────────────────────────
const POSITION_ADDRESS = process.env.POSITION_ADDRESS;
const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.CHAT_ID || "2005545171";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const REPORT_INTERVAL_MS = 60 * 60 * 1000;
const RPC_URL = "https://api.mainnet-beta.solana.com";
// ──────────────────────────────────────────────────────────

if (!POSITION_ADDRESS) {
  console.error("❌ POSITION_ADDRESS belum diisi di .env!");
  process.exit(1);
}
if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ BOT_TOKEN belum diisi di .env!");
  process.exit(1);
}

const DECIMAL_DIFF = 9 - 6;
const connection = new Connection(RPC_URL, "confirmed");
let lastStatus = null;

async function sendTelegram(msg) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
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
    const lowerBinId = positionAccount.lowerBinId;
    const upperBinId = positionAccount.upperBinId;

    const activeBin = await pool.getActiveBin();
    const currentPrice = parseFloat(pool.fromPricePerLamport(Number(activeBin.price)));
    const binStep = pool.lbPair.binStep;

    const lowerPrice = binIdToPrice(lowerBinId, binStep);
    const upperPrice = binIdToPrice(upperBinId, binStep);

    const { userPositions } = await pool.getPositionsByUserAndLbPair(positionPubkey);
    let feeX = 0, feeY = 0;
    if (userPositions && userPositions.length > 0) {
      const pos = userPositions[0].positionData;
      feeX = Number(pos.feeX) / 1e9;
      feeY = Number(pos.feeY) / 1e6;
    }

    return { lowerPrice, upperPrice, currentPrice, feeX, feeY };
  } catch (err) {
    console.error("Error getPositionInfo:", err.message);
    return null;
  }
}

async function checkPosition() {
  console.log(`[${new Date().toLocaleTimeString()}] Checking...`);
  const data = await getPositionInfo();
  if (!data) return;

  const { lowerPrice, upperPrice, currentPrice } = data;
  const inRange = currentPrice >= lowerPrice && currentPrice <= upperPrice;
  const status = inRange ? "in_range" : "out_of_range";

  console.log(`SOL: $${currentPrice.toFixed(2)} | Range: $${lowerPrice.toFixed(2)}-$${upperPrice.toFixed(2)} | ${status}`);

  if (status !== lastStatus) {
    if (status === "out_of_range") {
      await sendTelegram(
        `⚠️ *METEORA: OUT OF RANGE!*\n\n` +
        `💰 Harga: *$${currentPrice.toFixed(2)}*\n` +
        `📊 Range: *$${lowerPrice.toFixed(2)} - $${upperPrice.toFixed(2)}*\n\n` +
        `❗ Posisi idle, gak earn fee!\nPertimbangkan rebalance.`
      );
    } else if (status === "in_range" && lastStatus === "out_of_range") {
      await sendTelegram(
        `✅ *METEORA: BALIK IN RANGE!*\n\n` +
        `💰 Harga: *$${currentPrice.toFixed(2)}*\n` +
        `📊 Range: *$${lowerPrice.toFixed(2)} - $${upperPrice.toFixed(2)}*\n\n` +
        `🎉 Posisi aktif earn fee lagi!`
      );
    }
    lastStatus = status;
  }
}

async function sendReport() {
  console.log(`[${new Date().toLocaleTimeString()}] Sending report...`);
  const data = await getPositionInfo();
  if (!data) return;

  const { lowerPrice, upperPrice, currentPrice, feeX, feeY } = data;
  const inRange = currentPrice >= lowerPrice && currentPrice <= upperPrice;
  const totalFeeUsd = (feeX * currentPrice) + feeY;

  await sendTelegram(
    `📊 *Laporan Per Jam*\n\n` +
    `💰 Harga: *$${currentPrice.toFixed(2)}*\n` +
    `📍 Range: *$${lowerPrice.toFixed(2)} - $${upperPrice.toFixed(2)}*\n` +
    `Status: *${inRange ? "✅ In Range" : "⚠️ Out of Range"}*\n\n` +
    `💵 Unclaimed Fee:\n` +
    `   SOL: *${feeX.toFixed(6)}*\n` +
    `   USDC/token: *${feeY.toFixed(6)}*\n` +
    `   Total: *~$${totalFeeUsd.toFixed(4)}*\n\n` +
    `📍 Position: \`${POSITION_ADDRESS}\``
  );
}

async function main() {
  console.log("🚀 Meteora Monitor Bot started!");
  console.log(`📍 Position: ${POSITION_ADDRESS}`);

  await sendTelegram(`🚀 *Meteora Monitor Bot aktif!*\n📍 \`${POSITION_ADDRESS}\`\n⏱️ Cek range tiap 5 menit\n📊 Laporan tiap 1 jam`);

  await checkPosition();
  await sendReport();

  setInterval(checkPosition, CHECK_INTERVAL_MS);
  setInterval(sendReport, REPORT_INTERVAL_MS);
}

main().catch(console.error);
