const OWNER = "Yolo9203";
const REPO = "Repository-name-BRI-SLIP-GROUPER";

const EMAIL_CACHE_PATH = "data/email-cache.json";
const EXCEL_CACHE_PATH = "data/excel-cache.json";
const ALLOWED_USERS_PATH = "data/allowed-users.json";
const OUTPUT_INDEX_PATH = "data/output-index.json";

/**
 * CDP Slip Worker
 *
 * Fitur utama:
 * - Whitelist username Telegram dari data/allowed-users.json
 * - Cek CDP dari email-cache.json, excel-cache.json, dan output/
 * - Menampilkan beberapa pengajuan jika CDP sama muncul lebih dari satu kali
 * - Mencari slip di semua folder output/YYYY-MM-DD, bukan hanya folder terbaru
 * - Mendukung data baru:
 *   - excel-cache.json -> cdp_data
 *   - output-index.json -> hasil mapping PDF dari process.py
 * - Endpoint notifikasi:
 *   POST /notify
 *   Header: X-Notify-Secret: <NOTIFY_SECRET>
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Endpoint notifikasi dari GitHub Actions.
    if (request.method === "POST" && url.pathname === "/notify") {
      return handleNotify(request, env);
    }

    // GET /slip/1010 atau /slip/1010?folder=2026-06-08
    if (request.method === "GET" && url.pathname.startsWith("/slip/")) {
      const cdp4 = url.pathname.replace("/slip/", "").replace(/\D/g, "").padStart(4, "0");
      const folder = url.searchParams.get("folder");
      const file = url.searchParams.get("file");

      const slipData = await getSlipFile(env, cdp4, { folder, file });
      if (!slipData) {
        return new Response("File tidak ditemukan", { status: 404 });
      }
      return Response.redirect(slipData.download_url, 302);
    }

    if (request.method === "GET") {
      return new Response("CDP Slip Bot aktif");
    }

    let update, chatId, text, username;
    try {
      update = await request.json();
      chatId = update.message?.chat?.id;
      text = (update.message?.text || "").trim();
      username = update.message?.from?.username || null;
    } catch {
      return new Response("OK");
    }

    if (!chatId) return new Response("OK");

    try {
      // --- CEK USERNAME ---
      if (!username) {
        await sendMessage(env, chatId,
          `⚠️ Kamu belum memiliki username Telegram.\n\n` +
          `Silakan buat username terlebih dahulu:\n` +
          `Pengaturan → Edit Profil → Username\n\n` +
          `Setelah membuat username, coba lagi.`
        );
        return new Response("OK");
      }

      // --- CEK WHITELIST USERNAME ---
      const allowedUsers = await getAllowedUsers(env);
      if (allowedUsers.length > 0 && !allowedUsers.includes(username.toLowerCase())) {
        await sendMessage(env, chatId,
          `🚫 Username @${username} tidak memiliki otorisasi akses ke bot ini.\n\n` +
          `Silakan hubungi CDP via email.`
        );
        return new Response("OK");
      }

      // --- /start ---
      if (text === "/start") {
        await sendMessage(env, chatId,
          `👋 Selamat datang, @${username}!\n\n` +
          `Kamu terpilih untuk mengakses Bot Cek Slip Transfer CDP.\n` +
          `Gunakan bot ini dengan bijak dan bertanggung jawab.\n\n` +
          `📌 Cara pakai:\n` +
          `Cukup kirim nomor CDP kamu, contoh: 1064\n\n` +
          `⚠️ Harap diperhatikan:\n` +
          `• Jangan spam — bot berjalan di infrastruktur gratis\n` +
          `• Jika terasa lambat, mohon bersabar 🙏\n` +
          `• Bot hanya melayani pengecekan slip transfer maksimal sesuai data yang tersedia\n` +
          `• Jangan ganti username Telegram — akses akan hilang\n\n` +
          `🙏 Terima kasih kepada:\n` +
          `GitHub · Cloudflare · Claude AI · ChatGPT\n` +
          `dan semua pihak yang membantu pengembangan bot ini.`
        );
        await sendMessageWithButton(
          env, chatId,
          `📞 Butuh bantuan lain? Klik tombol di bawah:`,
          `💬 Chat WhatsApp`,
          `https://wa.me/6282153339483`
        );
        return new Response("OK");
      }

      // --- DEBUG UMUM ---
      if (text === "debug") {
        const testUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/output`;
        const res = await githubFetch(env, testUrl);
        const body = await res.text();
        await sendMessage(env, chatId, `Status: ${res.status}\n\n${body.slice(0, 500)}`);
        return new Response("OK");
      }

      // debugfile 1051 -> cari file di semua folder output
      if (text.startsWith("debugfile ")) {
        const num = text.replace("debugfile ", "").trim().replace(/\D/g, "").padStart(4, "0");
        const folders = await getOutputFolders(env);
        let msg = `📄 DEBUG FILE CDP ${num}\n\nFolder dicek: ${folders.length}\n`;

        const matches = await getSlipFiles(env, num);
        if (matches.length) {
          msg += `✅ Ditemukan ${matches.length} file:\n`;
          for (const m of matches.slice(0, 10)) {
            msg += `- ${m.folder}/${m.name}\n`;
          }
        } else {
          msg += `❌ Tidak ditemukan di folder output\n`;
          msg += `Sample folder:\n${folders.slice(0, 5).join("\n")}`;
        }

        await sendMessage(env, chatId, msg.slice(0, 3500));
        return new Response("OK");
      }

      // --- MAIN FLOW ---
      const cdp = text.replace(/\D/g, "");
      if (!cdp) {
        await sendMessage(env, chatId, "Kirim nomor CDP. Contoh: 1064");
        return new Response("OK");
      }

      const cdp4 = cdp.padStart(4, "0");
      const cdpKey = `CDP ${cdp4}`;

      const emailMatches = await getEmailDataList(env, cdp4);
      const excelData = await getExcelData(env, cdp4);
      const slipMatches = await getSlipFiles(env, cdp4);

      const hasEmail = emailMatches.length > 0;
      const excelFound = !!excelData?.found;
      const hasSlip = slipMatches.length > 0;

      let progress = 0;
      if (hasEmail) progress = 33;
      if (hasEmail && excelFound) progress = 66;
      if (hasEmail && excelFound && hasSlip) progress = 100;

      if (progress === 0) {
        await sendMessage(env, chatId, `❌ CDP ${cdp4} tidak ditemukan di sistem.`);
        return new Response("OK");
      }

      const statusText =
        progress === 100 ? "✅ Completed" :
        progress === 66 ? "⚙️ Diproses" :
        "📨 Pengajuan diterima";

      const bar = makeProgressBar(progress);

      let msg = `🔍 Hasil: ${cdpKey}\n\n`;

      // Jika ada beberapa email CDP yang sama, tampilkan sebagai beberapa pengajuan.
      if (emailMatches.length <= 1) {
        const emailData = emailMatches[0] || null;
        msg += formatSingleResult(cdp4, emailData, excelData, slipMatches);
      } else {
        msg += `Ditemukan ${emailMatches.length} pengajuan dengan nomor CDP yang sama.\n\n`;
        emailMatches.forEach((emailData, idx) => {
          const processMatch = matchProcessRecord(emailData, excelData?.records || []);
          msg += `#${idx + 1} PENGAJUAN\n`;
          msg += formatEmailBlock(emailData);
          msg += formatProcessBlock(processMatch, excelData);
          msg += `\n`;
        });

        if (hasSlip) {
          msg += `💳 BAYAR\n`;
          msg += `Slip ditemukan : ${slipMatches.length} file\n`;
          msg += `Folder         : ${unique(slipMatches.map(s => s.folder)).join(", ")}\n`;
        }
      }

      msg += `\n📊 Status\n`;
      msg += `${bar} ${progress}/100 ${statusText}`;

      // Tombol slip.
      if (hasSlip) {
        const buttons = slipMatches.slice(0, 8).map((s, i) => {
          const slipUrl = `${url.origin}/slip/${cdp4}?folder=${encodeURIComponent(s.folder)}&file=${encodeURIComponent(s.name)}`;
          const label = slipMatches.length === 1
            ? `📄 Slip Transfer ${cdpKey}`
            : `📄 Slip ${i + 1} - ${s.folder}`;
          return [{ text: label, url: slipUrl }];
        });

        await sendMessageWithButtons(env, chatId, msg, buttons);
      } else {
        await sendMessage(env, chatId, msg);
      }

    } catch (err) {
      await sendMessage(env, chatId, `⚠️ Terjadi error tidak terduga: ${err.message}`);
    }

    return new Response("OK");
  },
};

function makeProgressBar(progress) {
  const filled = Math.round(progress / 10);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function formatSingleResult(cdp4, emailData, excelData, slipMatches) {
  let msg = "";

  if (emailData) {
    msg += formatEmailBlock(emailData);
  }

  msg += formatProcessBlock(null, excelData);

  if (slipMatches.length) {
    msg += `\n💳 BAYAR\n`;
    msg += `Slip      : tersedia\n`;
    msg += `Folder    : ${slipMatches[0].folder}\n`;
  }

  return msg;
}

function formatEmailBlock(emailData) {
  if (!emailData) return "";

  let msg = `📧 EMAIL\n`;
  msg += `Dari    : ${emailData.from || "-"}\n`;
  msg += `Tanggal : ${emailData.date || "-"}\n`;
  msg += `Subject : ${emailData.subject || "-"}\n`;
  return msg;
}

function formatProcessBlock(processRecord, excelData) {
  if (!excelData?.found) {
    return `\n⚙️ PROSES\nBelum diproses\n`;
  }

  const rec = processRecord || (excelData.records?.length === 1 ? excelData.records[0] : null);

  if (rec) {
    return `\n⚙️ PROSES\n` +
      `Total   : ${formatRupiah(rec.total)}\n` +
      `Penerima: ${rec.penerima || rec.rows || 0} orang\n` +
      `Tgl     : ${rec.tanggal_proses || excelData.tanggal_proses || "-"}\n`;
  }

  // Jika CDP ada di Excel, tapi records lebih dari satu dan belum bisa dipasangkan dengan email tertentu.
  if (excelData.records?.length > 1) {
    let totalAll = excelData.records.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
    let penerimaAll = excelData.records.reduce((sum, r) => sum + (Number(r.penerima || r.rows) || 0), 0);
    return `\n⚙️ PROSES\n` +
      `Total   : ${formatRupiah(totalAll)}\n` +
      `Penerima: ${penerimaAll} orang\n` +
      `Tgl     : ${excelData.tanggal_proses || "-"}\n`;
  }

  return `\n⚙️ PROSES\n` +
    `Tgl     : ${excelData.tanggal_proses || "-"}\n`;
}

function matchProcessRecord(emailData, records) {
  if (!emailData || !records.length) return null;

  // Prioritas 1: nominal email sama dengan total proses Excel.
  if (emailData.nominal_int) {
    const exact = records.find(r => Number(r.total) === Number(emailData.nominal_int));
    if (exact) return exact;
  }

  // Prioritas 2: subject email mirip dengan KET Excel.
  const subj = normalizeText(emailData.subject || "");
  let best = null;
  let bestScore = 0;

  for (const r of records) {
    const ket = normalizeText(r.ket || "");
    if (!ket) continue;

    const score = similarityScore(subj, ket);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }

  if (bestScore >= 2) return best;

  // Prioritas 3: kalau cuma satu record, pakai itu.
  if (records.length === 1) return records[0];

  return null;
}

function similarityScore(a, b) {
  const wordsA = new Set(a.split(/\s+/).filter(w => w.length >= 4));
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length >= 4));
  let score = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) score++;
  }
  return score;
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/rp\.?\s*[\d.,]+/g, " ")
    .replace(/cdp\s*\d+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function parseNominalFromText(text) {
  const s = String(text || "");
  const match = s.match(/(?:rp|idr)\.?\s*([\d.,]+)/i);
  if (!match) return { text: "-", value: null };

  const value = parseRupiahNumber(match[1]);
  return {
    text: value ? formatRupiah(value) : `Rp ${match[1].replace(/-$/, "")}`,
    value,
  };
}

function parseRupiahNumber(valueText) {
  if (!valueText) return null;
  let s = String(valueText).replace(/[^\d,\.]/g, "");

  // Format Indonesia umum: 1.465.000 atau 4.410.000,00
  if (s.includes(".") && s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(".")) {
    s = s.replace(/\./g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }

  const n = Math.round(Number(s));
  return Number.isFinite(n) ? n : null;
}

function formatRupiah(n) {
  const num = Number(n || 0);
  if (!num) return "Rp 0";
  return "Rp " + num.toLocaleString("id-ID");
}

async function getAllowedUsers(env) {
  try {
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${ALLOWED_USERS_PATH}`;
    const res = await githubFetch(env, url);
    if (!res.ok) return [];
    const meta = await res.json();
    const content = atob(meta.content.replace(/\n/g, ""));
    return JSON.parse(content).map(u => String(u).toLowerCase().replace(/^@/, ""));
  } catch {
    return [];
  }
}

async function getEmailDataList(env, cdp4) {
  try {
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${EMAIL_CACHE_PATH}`;
    const res = await githubFetch(env, url);
    if (!res.ok) return [];
    const meta = await res.json();
    const content = atob(meta.content.replace(/\n/g, ""));
    const emails = JSON.parse(content);

    const re = new RegExp(`\\bCDP\\s*0*${Number(cdp4)}\\b`, "i");

    return emails
      .filter(e => e.subject && re.test(e.subject))
      .map(e => {
        const nominal = parseNominalFromText(e.subject);
        return {
          ...e,
          cdp: cdp4,
          nominal: nominal.text,
          nominal_int: nominal.value,
        };
      });
  } catch {
    return [];
  }
}

async function getExcelData(env, cdp4) {
  try {
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${EXCEL_CACHE_PATH}`;
    const res = await githubFetch(env, url);
    if (!res.ok) return null;

    const meta = await res.json();
    const content = atob(meta.content.replace(/\n/g, ""));
    const cache = JSON.parse(content);

    // Format lama.
    const cdpList = Array.isArray(cache) ? cache : (cache.cdp_list || []);
    const tanggalMap = Array.isArray(cache) ? {} : (cache.tanggal_proses || {});
    const foundOld = cdpList.includes(cdp4);

    // Format baru.
    const rawRecords = cache.cdp_data?.[cdp4] || [];
    const records = Array.isArray(rawRecords) ? rawRecords : [rawRecords];

    const found = foundOld || records.length > 0;
    const tanggal = tanggalMap[cdp4] || records[0]?.tanggal_proses || null;

    return {
      found,
      tanggal_proses: tanggal,
      records: records.filter(Boolean),
    };
  } catch {
    return null;
  }
}

async function getSlipFiles(env, cdp4) {
  // Prioritas: output-index.json jika tersedia.
  const indexed = await getSlipFilesFromIndex(env, cdp4);
  if (indexed.length) return indexed;

  // Fallback: cari langsung di semua folder output.
  const folders = await getOutputFolders(env);
  if (!folders.length) return [];

  const fileName = `CDP ${cdp4}.pdf`;
  const encoded = encodeURIComponent(fileName).replace(/%2F/g, "/");

  const found = [];
  for (const folder of folders) {
    const fileUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/output/${folder}/${encoded}`;
    const res = await githubFetch(env, fileUrl);

    if (res.ok) {
      const data = await res.json();
      if (data.download_url) {
        found.push({
          ...data,
          folder,
          name: fileName,
        });
      }
    }
  }

  return found;
}

async function getSlipFile(env, cdp4, opts = {}) {
  const folder = opts.folder || null;
  const file = opts.file || null;

  // Jika folder dan file dikirim dari tombol, ambil langsung.
  if (folder) {
    const fileName = file || `CDP ${cdp4}.pdf`;
    const encoded = encodeURIComponent(fileName).replace(/%2F/g, "/");
    const fileUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/output/${folder}/${encoded}`;
    const res = await githubFetch(env, fileUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.download_url) return { ...data, folder, name: fileName };
    }
  }

  const files = await getSlipFiles(env, cdp4);
  return files[0] || null;
}

async function getSlipFilesFromIndex(env, cdp4) {
  try {
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${OUTPUT_INDEX_PATH}`;
    const res = await githubFetch(env, url);
    if (!res.ok) return [];

    const meta = await res.json();
    const content = atob(meta.content.replace(/\n/g, ""));
    const index = JSON.parse(content);
    const rows = Array.isArray(index) ? index : (index.items || []);

    const matches = rows.filter(row => {
      return String(row.cdp || "").padStart(4, "0") === cdp4;
    });

    return matches.map(row => ({
      folder: row.folder,
      name: row.file || `CDP ${cdp4}.pdf`,
      download_url: row.download_url || null,
      html_url: row.html_url || null,
      path: `output/${row.folder}/${row.file || `CDP ${cdp4}.pdf`}`,
    })).filter(row => row.folder && row.name);
  } catch {
    return [];
  }
}

async function getOutputFolders(env) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/output`;
  const res = await githubFetch(env, url);
  if (!res.ok) return [];

  const items = await res.json();
  return items
    .filter(item => item.type === "dir" && /^\d{4}-\d{2}-\d{2}$/.test(item.name))
    .map(item => item.name)
    .sort()
    .reverse();
}

async function handleNotify(request, env) {
  const secret = request.headers.get("X-Notify-Secret") || "";
  if (env.NOTIFY_SECRET && secret !== env.NOTIFY_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const text = payload.text || "Notifikasi CDP Bot";
  const chatIds = getNotifyChatIds(env);

  if (!chatIds.length) {
    return new Response("No chat id configured", { status: 200 });
  }

  for (const chatId of chatIds) {
    await sendMessage(env, chatId, text);
  }

  return new Response("OK");
}

function getNotifyChatIds(env) {
  const ids = [];
  if (env.NOTIFY_CHAT_IDS) {
    ids.push(...String(env.NOTIFY_CHAT_IDS).split(",").map(x => x.trim()).filter(Boolean));
  }
  if (env.OWNER_CHAT_ID) {
    ids.push(String(env.OWNER_CHAT_ID).trim());
  }
  return unique(ids);
}

function githubFetch(env, url) {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "cdp-slip-worker",
    },
  });
}

function sendMessage(env, chatId, text) {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
}

function sendMessageWithButton(env, chatId, text, buttonLabel, buttonUrl) {
  return sendMessageWithButtons(env, chatId, text, [[{ text: buttonLabel, url: buttonUrl }]]);
}

function sendMessageWithButtons(env, chatId, text, inlineKeyboard) {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: inlineKeyboard,
      },
    }),
  });
}
