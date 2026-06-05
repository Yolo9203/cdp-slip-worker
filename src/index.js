const OWNER = "Yolo9203";
const REPO = "Repository-name-BRI-SLIP-GROUPER";
const EMAIL_CACHE_PATH = "data/email-cache.json";

export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return new Response("CDP Slip Bot aktif");
    }

    const update = await request.json();
    const chatId = update.message?.chat?.id;
    const text = (update.message?.text || "").trim();
    if (!chatId) return new Response("OK");

    // DEBUG SEMENTARA
    if (text === "debug") {
      const testUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/output`;
      const res = await githubFetch(env, testUrl);
      const body = await res.text();
      await sendMessage(env, chatId, `Status: ${res.status}\n\n${body.slice(0, 500)}`);
      return new Response("OK");
    }

    const cdp = text.replace(/\D/g, "");
    if (!cdp) {
      await sendMessage(env, chatId, "Kirim nomor CDP. Contoh: 1064");
      return new Response("OK");
    }

    const cdp4 = cdp.padStart(4, "0");
    const cdpKey = `CDP ${cdp4}`;

    const [emailData, excelFound, slipData] = await Promise.all([
      getEmailData(env, cdp4),
      checkExcel(env, cdp4),
      getSlipFile(env, cdp4),
    ]);

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
      msg += `Dari    : ${emailData.from}\n`;
      msg += `Tanggal : ${emailData.date}\n`;
      msg += `Subject : ${emailData.subject}\n`;
      msg += `Nominal : ${emailData.nominal}\n\n`;
    }

    msg += `📊 Status\n`;
    msg += `${bar} ${progress}/100 ${statusText}`;

    if (slipData) {
      const slipMsg = msg + `\n\n📄 <a href="${slipData.download_url}">Slip Transfer ${cdpKey}</a>`;
      await sendMessageHTML(env, chatId, slipMsg);
    } else {
      await sendMessage(env, chatId, msg);
    }

    return new Response("OK");
  },
};

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

    const nominalMatch = found.subject.match(/Rp[\s]?([\d.,]+)/i);
    const nominal = nominalMatch ? `Rp ${nominalMatch[1]}` : "-";

    return {
      from: found.from,
      date: found.date,
      subject: found.subject,
      nominal,
    };
  } catch {
    return null;
  }
}

async function checkExcel(env, cdp4) {
  try {
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/data/excel-cache.json`;
    const res = await githubFetch(env, url);
    if (!res.ok) return false;

    const meta = await res.json();
    const content = atob(meta.content.replace(/\n/g, ""));
    const cdpList = JSON.parse(content);

    return cdpList.includes(cdp4);
  } catch {
    return false;
  }
}

async function getSlipFile(env, cdp4) {
  try {
    const latestFolder = await getLatestOutputFolder(env);
    if (!latestFolder) return null;

    const fileName = `CDP ${cdp4}.pdf`;
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/output/${latestFolder}/${encodeURIComponent(fileName)}`;
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

function sendMessageHTML(env, chatId, text) {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}
