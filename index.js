const { Connection, PublicKey } = require("@solana/web3.js");
const fetch = require("node-fetch");
const DLMM = require("@meteora-ag/dlmm");

// ─── CONFIG ───────────────────────────────────────────────
const POSITION_ADDRESS = "A5coXd9ojUGa4wsPFjyM7xoiRFeLsY38zNQr2mKE7mrt";
const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_CHAT_ID = "2005545171";
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 menit
const RPC_URL = "https://api.mainnet-beta.solana.com";
// ──────────────────────────────────────────────────────────

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

async function getPositionInfo() {
  try {
    // Cek semua export yang tersedia
    const DLMMModule = require("@meteora-ag/dlmm");
    console.log("DLMM exports:", Object.keys(DLMMModule));
    
    const DLMMClass = DLMMModule.default || DLMMModule.DLMM || DLMMModule;
    if (!DLMMClass || typeof DLMMClass.create !== "function") {
      throw new Error(`DLMM.create not found. Keys: ${Object.keys(DLMMModule).join(", ")}`);
    }

    const accountInfo = await connection.getAccountInfo(new PublicKey(POSITION_ADDRESS));
    if (!accountInfo) throw new Error("Position account not found");

    const lbPairKey = new PublicKey(accountInfo.data.slice(8, 40));
    const pool = await DLMMClass.create(connection, lbPairKey);

    const activeBin = await pool.getActiveBin();
    const currentPrice = parseFloat(pool.fromPricePerLamport(Number(activeBin.price)));

    const lowerBinId = accountInfo.data.readInt32LE(40);
    const upperBinId = accountInfo.data.readInt32LE(44);
    const binStep = pool.lbPair.binStep;

    const lowerPrice = Math.pow(1 + binStep / 10000, lowerBinId);
    const upperPrice = Math.pow(1 + binStep / 10000, upperBinId);

    return { lowerPrice, upperPrice, currentPrice };
  } catch (err) {
    console.error("Error getPositionInfo:", err.message);
    return null;
  }
}

async function checkPosition() {
  console.log(`[${new Date().toLocaleTimeString()}] Checking...`);

  const data = await getPositionInfo();
  if (!data) {
    console.log("Gagal ambil data, skip.");
    return;
  }

  const { lowerPrice, upperPrice, currentPrice } = data;
  const inRange = currentPrice >= lowerPrice && currentPrice <= upperPrice;
  const status = inRange ? "in_range" : "out_of_range";

  console.log(`SOL: $${currentPrice.toFixed(2)} | Range: $${lowerPrice.toFixed(2)}-$${upperPrice.toFixed(2)} | ${status}`);

  if (status !== lastStatus) {
    if (status === "out_of_range") {
      await sendTelegram(
        `⚠️ *METEORA: OUT OF RANGE!*\n\n` +
        `💰 Harga SOL: *$${currentPrice.toFixed(2)}*\n` +
        `📊 Range: *$${lowerPrice.toFixed(2)} - $${upperPrice.toFixed(2)}*\n\n` +
        `❗ Posisi lu idle, gak earn fee!\nPertimbangkan rebalance.`
      );
    } else if (status === "in_range" && lastStatus === "out_of_range") {
      await sendTelegram(
        `✅ *METEORA: BALIK IN RANGE!*\n\n` +
        `💰 Harga SOL: *$${currentPrice.toFixed(2)}*\n` +
        `📊 Range: *$${lowerPrice.toFixed(2)} - $${upperPrice.toFixed(2)}*\n\n` +
        `🎉 Posisi aktif earn fee lagi!`
      );
    }
    lastStatus = status;
  }
}

async function main() {
  console.log("🚀 Meteora Monitor Bot started!");
  console.log(`📍 Position: ${POSITION_ADDRESS}`);
  console.log(`⏱️  Interval: ${CHECK_INTERVAL_MS / 60000} menit\n`);

  await sendTelegram(
    `🚀 *Meteora Monitor Bot aktif!*\n` +
    `📍 \`${POSITION_ADDRESS}\`\n` +
    `⏱️ Cek tiap 5 menit`
  );

  await checkPosition();
  setInterval(checkPosition, CHECK_INTERVAL_MS);
}

main().catch(console.error);
