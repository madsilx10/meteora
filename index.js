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

let lastStatus = null; // "in_range" | "out_of_range"

async function sendTelegram(msg) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: msg,
      parse_mode: "Markdown",
    }),
  });
}

async function getPositionData() {
  try {
    const res = await fetch(
      `https://dlmm-api.meteora.ag/position/${POSITION_ADDRESS}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data;
  } catch (err) {
    console.error("Error fetch position:", err.message);
    return null;
  }
}

async function getCurrentPrice(poolAddress) {
  try {
    const res = await fetch(
      `https://dlmm-api.meteora.ag/pair/${poolAddress}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return parseFloat(data.current_price);
  } catch (err) {
    console.error("Error fetch price:", err.message);
    return null;
  }
}

async function checkPosition() {
  console.log(`[${new Date().toLocaleTimeString()}] Checking position...`);

  const position = await getPositionData();
  if (!position) {
    console.log("Gagal ambil data posisi, skip.");
    return;
  }

  const lowerPrice = parseFloat(position.lower_bin_price);
  const upperPrice = parseFloat(position.upper_bin_price);
  const poolAddress = position.lb_pair;

  const currentPrice = await getCurrentPrice(poolAddress);
  if (!currentPrice) {
    console.log("Gagal ambil harga, skip.");
    return;
  }

  const inRange = currentPrice >= lowerPrice && currentPrice <= upperPrice;
  const status = inRange ? "in_range" : "out_of_range";

  console.log(
    `Harga SOL: $${currentPrice.toFixed(2)} | Range: $${lowerPrice.toFixed(2)} - $${upperPrice.toFixed(2)} | Status: ${status}`
  );

  // Notif kalau status berubah
  if (status !== lastStatus) {
    if (status === "out_of_range") {
      await sendTelegram(
        `⚠️ *METEORA: OUT OF RANGE!*\n\n` +
        `💰 Harga SOL sekarang: *$${currentPrice.toFixed(2)}*\n` +
        `📊 Range lu: *$${lowerPrice.toFixed(2)} - $${upperPrice.toFixed(2)}*\n\n` +
        `❗ Posisi lu gak earn fee. Pertimbangkan rebalance!`
      );
    } else if (status === "in_range" && lastStatus === "out_of_range") {
      await sendTelegram(
        `✅ *METEORA: KEMBALI IN RANGE!*\n\n` +
        `💰 Harga SOL sekarang: *$${currentPrice.toFixed(2)}*\n` +
        `📊 Range lu: *$${lowerPrice.toFixed(2)} - $${upperPrice.toFixed(2)}*\n\n` +
        `🎉 Posisi lu aktif earn fee lagi!`
      );
    }
    lastStatus = status;
  }
}

async function main() {
  console.log("🚀 Meteora Monitor Bot started!");
  console.log(`📍 Position: ${POSITION_ADDRESS}`);
  console.log(`⏱️  Check interval: ${CHECK_INTERVAL_MS / 1000 / 60} menit\n`);

  await sendTelegram(
    `🚀 *Meteora Monitor Bot aktif!*\n\n` +
    `📍 Position: \`${POSITION_ADDRESS}\`\n` +
    `⏱️ Cek setiap 5 menit`
  );

  // Cek langsung pas start
  await checkPosition();

  // Loop tiap 5 menit
  setInterval(checkPosition, CHECK_INTERVAL_MS);
}

main().catch(console.error);
