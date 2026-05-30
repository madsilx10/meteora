const { Connection, PublicKey } = require("@solana/web3.js");
const fetch = require("node-fetch");

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
    const DLMMModule = require("@meteora-ag/dlmm");
    const DLMMClass = DLMMModule.default || DLMMModule.DLMM || DLMMModule;

    const accountInfo = await connection.getAccountInfo(new PublicKey(POSITION_ADDRESS));
    if (!accountInfo) throw new Error("Position account not found");

    const data = accountInfo.data;
    const lbPairKey = new PublicKey(data.slice(8, 40));

    const pool = await DLMMClass.create(connection, lbPairKey);

    // Ambil posisi user langsung via SDK
    const positionPubkey = new PublicKey(POSITION_ADDRESS);
    const { userPositions } = await pool.getPositionsByUserAndLbPair(positionPubkey);

    let lowerBinId, upperBinId;

    if (userPositions && userPositions.length > 0) {
      lowerBinId = userPositions[0].positionData.lowerBinId;
      upperBinId = userPositions[0].positionData.upperBinId;
    } else {
      // Fallback: parse langsung dari position account pake SDK decoder
      const positionAccount = await pool.program.account.positionV2.fetch(positionPubkey);
      lowerBinId = positionAccount.lowerBinId;
      upperBinId = positionAccount.upperBinId;
    }

    const activeBin = await pool.getActiveBin();
    const currentPrice = parseFloat(pool.fromPricePerLamport(Number(activeBin.price)));
    const binStep = pool.lbPair.binStep;

    const lowerPrice = Math.pow(1 + binStep / 10000, lowerBinId);
    const upperPrice = Math.pow(1 + binStep / 10000, upperBinId);

    console.log(`BinStep: ${binStep} | Lower: ${lowerBinId} ($${lowerPrice.toFixed(2)}) | Upper: ${upperBinId} ($${upperPrice.toFixed(2)})`);

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
  await sendTelegram(`🚀 *Meteora Monitor Bot aktif!*\n📍 \`${POSITION_ADDRESS}\`\n⏱️ Cek tiap 5 menit`);
  await checkPosition();
  setInterval(checkPosition, CHECK_INTERVAL_MS);
}

main().catch(console.error);
