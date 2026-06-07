const OWNER = "Yolo9203";
const REPO = "Repository-name-BRI-SLIP-GROUPER";
const EMAIL_CACHE_PATH = "data/email-cache.json";
const EXCEL_CACHE_PATH = "data/excel-cache.json";
const ALLOWED_USERS_PATH = "data/allowed-users.json";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // GET /slip/1010 → redirect ke download_url asli
    if (request.method === "GET" && url.pathname.startsWith("/slip/")) {
      const cdp4 = url.pathname.replace("/slip/", "").replace(/\D/g, "").padStart(4, "0");
      const slipData = await getSlipFile(env, cdp4);
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

      // --- CEK WHITELIST (berbasis username) ---
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
          `• Bot hanya melayani pengecekan slip transfer maximal 30 Hari Kalender\n` +
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

      // --- DEBUG ---
      if (text === "debug") {
        const testUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/output`;
        const res = await githubFetch(env, testUrl);
        const body = await res.text();
        await sendMessage(env, chatId, `Status: ${res.status}\n\n${body.slice(0, 500)}`);
        return new Response("OK");
      }

      if (text.startsWith("debugfile ")) {
        const num = text.replace("debugfile ", "").trim().replace(/\D/g, "").padStart(4, "0");
        const latestFolder = await getLatestOutputFolder(env);
        const fileName = `CDP ${num}.pdf`;
        const encoded = fileName.replace(/ /g, "%20");
        const fileUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/output/${latestFolder}/${encoded}`;
        const res = await githubFetch(env, fileUrl);
        await sendMessage(env, chatId,
          `Folder: ${latestFolder}\nFile: ${fileName}\nStatus: ${res.status}\nURL: ${fileUrl}`
        );
        return new Response("OK");
      }

      if (text === "debug1010" || text === "debug1049") {
        const num = text === "debug1010" ? "1010" : "1049";

        let emailMsg = `📧 EMAIL (CDP ${num})\n`;
        try {
          const url2 = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${EMAIL_CACHE_PATH}`;
          const res = await githubFetch(env, url2);
          emailMsg += `Status fetch: ${res.status}\n`;
          if (res.ok) {
            const meta = await res.json();
            const content = atob(meta.content.replace(/\n/g, ""));
            const emails = JSON.parse(content);
            const matches = emails.filter(e => e.subject && e.subject.includes(num));
            if (matches.length > 0) {
              emailMsg += `✅ Ditemukan ${matches.length} entry:\n`;
              matches.forEach((m, i) => {
                emailMsg += `[${i+1}] from: ${m.from}\n`;
                emailMsg += `     subject: "${m.subject}"\n`;
                emailMsg += `     date: ${m.date}\n`;
              });
            } else {
              emailMsg += `❌ Tidak ada subject yang mengandung "${num}"\n`;
              emailMsg += `\nSample 3 subject terakhir:\n`;
              emails.slice(-3).forEach(e => emailMsg += `- "${e.subject}"\n`);
            }
          }
        } catch (err) {
          emailMsg += `Error: ${err.message}\n`;
        }
        await sendMessage(env, chatId, emailMsg);

        let excelMsg = `📊 EXCEL (CDP ${num})\n`;
        try {
          const url2 = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${EXCEL_CACHE_PATH}`;
          const res = await githubFetch(env, url2);
          excelMsg += `Status fetch: ${res.status}\n`;
          if (res.ok) {
            const meta = await res.json();
            const content = atob(meta.content.replace(/\n/g, ""));
            const cache = JSON.parse(content);
            const cdpList = Array.isArray(cache) ? cache : (cache.cdp_list || []);
            const found = cdpList.includes(num);
            excelMsg += found ? `✅ CDP ${num} ADA di excel-cache\n` : `❌ CDP ${num} TIDAK ada\n`;
            const tgl = cache.tanggal_proses?.[num] || "-";
            excelMsg += `Tanggal proses: ${tgl}\n`;
          }
        } catch (err) {
          excelMsg += `Error: ${err.message}\n`;
        }
        await sendMessage(env, chatId, excelMsg);

        let slipMsg = `📄 SLIP FILE (CDP ${num})\n`;
        try {
          const latestFolder = await getLatestOutputFolder(env);
          slipMsg += `Folder terbaru: ${latestFolder}\n`;
          if (latestFolder) {
            const fileName = `CDP ${num}.pdf`;
            const encoded = fileName.replace(/ /g, "%20");
            const url2 = `https://api.github.com/repos/${OWNER}/${REPO}/contents/output/${latestFolder}/${encoded}`;
            slipMsg += `URL dicari: ${url2}\n`;
            const res = await githubFetch(env, url2);
            slipMsg += `Status: ${res.status}\n`;
            if (res.ok) {
              const data = await res.json();
              slipMsg += `✅ File ada!\ndownload_url:\n${data.download_url}\n`;
            } else {
              slipMsg += `❌ File tidak ditemukan\n`;
              const folderUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/output/${latestFolder}`;
              const folderRes = await githubFetch(env, folderUrl);
              if (folderRes.ok) {
                const files = await folderRes.json();
                const cdpFiles = files.filter(f => f.name.includes(num));
                slipMsg += `File mengandung "${num}": ${JSON.stringify(cdpFiles.map(f => f.name))}\n`;
                slipMsg += `\nSample 3 nama file di folder:\n`;
                files.slice(0, 3).forEach(f => slipMsg += `- "${f.name}"\n`);
              }
            }
          }
        } catch (err) {
          slipMsg += `Error: ${err.message}\n`;
        }
        await sendMessage(env, chatId, slipMsg);

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

      let emailData = null;
      let excelData = null;
      let slipData = null;

      try { emailData = await getEmailData(env, cdp4); } catch {}
      try { excelData = await getExcelData(env, cdp4); } catch {}
      try { slipData = await getSlipFile(env, cdp4); } catch {}

      const excelFound = excelData?.found || false;
      const tanggalProses = excelData?.tanggal_proses || null;

      let progress = 0;
      let statusText = "";
      if (emailData) progress = 33;
      if (emailData && excelFound) progress = 66;
      if (emailData && excelFound && slipData) progress = 100;

      if (progress === 0) {
        await sendMessage(env, chatId, `❌ CDP ${cdp4} tidak ditemukan di sistem.`);
        return new Response("OK");
      }

      const filled = Math.round(progress / 10);
      const empty = 10 - filled;
      const bar = "█".repeat(filled) + "░".repeat(empty);

      if (progress === 100) statusText = "✅ Completed";
      else if (progress === 66) statusText = "⚙️ Diproses";
      else statusText = "📨 Pengajuan diterima";

      let msg = `🔍 Hasil: ${cdpKey}\n\n`;

      if (emailData) {
        msg += `📧 EMAIL\n`;
        msg += `Dari       : ${emailData.from}\n`;
        msg += `Tanggal    : ${emailData.date}\n`;
        msg += `Subject    : ${emailData.subject}\n`;
        msg += `Nominal    : ${emailData.nominal}\n`;
        if (tanggalProses) {
          msg += `Tgl Proses : ${tanggalProses}\n`;
        }
      }

      msg += `\n📊 Status\n`;
      msg += `${bar} ${progress}/100 ${statusText}`;

      if (slipData) {
        const shortUrl = `${url.origin}/slip/${cdp4}`;
        await sendMessageWithButton(env, chatId, msg, `📄 Slip Transfer ${cdpKey}`, shortUrl);
      } else {
        await sendMessage(env, chatId, msg);
      }

    } catch (err) {
      await sendMessage(env, chatId, `⚠️ Terjadi error tidak terduga: ${err.message}`);
    }

    return new Response("OK");
  },
};

// ✅ Baca username dari allowed-users.json (tanpa @, case-insensitive)
async function getAllowedUsers(env) {
  try {
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${ALLOWED_USERS_PATH}`;
    const res = await githubFetch(env, url);
    if (!res.ok) return [];
    const meta = await res.json();
    const content = atob(meta.content.replace(/\n/g, ""));
    return JSON.parse(content).map(u => u.toLowerCase().replace(/^@/, ""));
  } catch {
    return [];
  }
}

async function getEmailData(env, cdp4) {
  try {
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${EMAIL_CACHE_PATH}`;
    const res = await githubFetch(env, url);
    if (!res.ok) return null;
    const meta = await res.json();
    const content = atob(meta.content.replace(/\n/g, ""));
    const emails = JSON.parse(content);
    const found = emails.find(e =>
      e.subject && e.subject.toUpperCase().includes(`CDP ${cdp4}`)
    );
    if (!found) return null;
    const nominalMatch = found.subject.match(/Rp\.?\s*([\d.,]+)/i);
    const nominal = nominalMatch ? `Rp ${nominalMatch[1].replace(/-$/, "")}` : "-";
    return { from: found.from, date: found.date, subject: found.subject, nominal };
  } catch {
    return null;
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
    const cdpList = Array.isArray(cache) ? cache : (cache.cdp_list || []);
    const tanggalMap = Array.isArray(cache) ? {} : (cache.tanggal_proses || {});
    return {
      found: cdpList.includes(cdp4),
      tanggal_proses: tanggalMap[cdp4] || null,
    };
  } catch {
    return null;
  }
}

async function getSlipFile(env, cdp4) {
  try {
    const latestFolder = await getLatestOutputFolder(env);
    if (!latestFolder) return null;
    const fileName = `CDP ${cdp4}.pdf`;
    const encoded = fileName.replace(/ /g, "%20");
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/output/${latestFolder}/${encoded}`;
    const res = await githubFetch(env, url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.download_url ? data : null;
  } catch {
    return null;
  }
}

async function getLatestOutputFolder(env) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/output`;
  const res = await githubFetch(env, url);
  if (!res.ok) return null;
  const items = await res.json();
  const folders = items
    .filter(item => item.type === "dir" && /^\d{4}-\d{2}-\d{2}$/.test(item.name))
    .map(item => item.name)
    .sort()
    .reverse();
  return folders[0] || null;
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
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

function sendMessageWithButton(env, chatId, text, buttonLabel, buttonUrl) {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [[{ text: buttonLabel, url: buttonUrl }]]
      }
    }),
  });
}
