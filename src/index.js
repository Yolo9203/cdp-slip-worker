const OWNER = "Yolo9203";
const REPO = "Repository-name-BRI-SLIP-GROUPER";

export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return new Response("CDP Slip Bot aktif");
    }

    const update = await request.json();
    const chatId = update.message?.chat?.id;
    const text = (update.message?.text || "").trim();

    if (!chatId) return new Response("OK");

    const cdp = text.replace(/\D/g, "");
    if (!cdp) {
      await sendMessage(env, chatId, "Kirim nomor CDP. Contoh: 1007");
      return new Response("OK");
    }

    const cdp4 = cdp.padStart(4, "0");

    const latestFolder = await getLatestOutputFolder(env);
    if (!latestFolder) {
      await sendMessage(env, chatId, "Folder output belum ditemukan.");
      return new Response("OK");
    }

    const fileName = `CDP ${cdp4}.pdf`;
    const fileApiUrl =
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/output/${latestFolder}/${encodeURIComponent(fileName)}`;

    const fileRes = await githubFetch(env, fileApiUrl);

    if (!fileRes.ok) {
      await sendMessage(env, chatId, `Slip CDP ${cdp4} belum ditemukan di folder ${latestFolder}.`);
      return new Response("OK");
    }

    const fileData = await fileRes.json();

    if (!fileData.download_url) {
      await sendMessage(env, chatId, `File CDP ${cdp4} ditemukan, tapi tidak bisa diunduh.`);
      return new Response("OK");
    }

    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        document: fileData.download_url,
        caption: `✅ Slip CDP ${cdp4}\nTanggal folder: ${latestFolder}`
      })
    });

    return new Response("OK");
  }
};

async function getLatestOutputFolder(env) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/output`;
  const res = await githubFetch(env, url);
  if (!res.ok) return null;

  const items = await res.json();
  const folders = items
    .filter(item => item.type === "dir")
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
      "User-Agent": "cdp-slip-worker"
    }
  });
}

function sendMessage(env, chatId, text) {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text
    })
  });
}
