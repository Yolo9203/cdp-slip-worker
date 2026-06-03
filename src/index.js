export default {
  async fetch(request, env) {
    if (request.method === "GET") {

  const r = await fetch(
    "https://api.github.com/repos/Yolo9203/Repository-name-BRI-SLIP-GROUPER/contents/output",
    {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      }
    }
  );

  const data = await r.json();

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json"
    }
  });
    }

    const update = await request.json();

    const chatId = update.message?.chat?.id;
    const text = (update.message?.text || "").trim();

    if (!chatId) {
      return new Response("OK");
    }

    const cdp = text.replace(/\D/g, "");

    if (!cdp) {
      await sendMessage(env, chatId, "Kirim nomor CDP. Contoh: 1007");
      return new Response("OK");
    }

    const cdp4 = cdp.padStart(4, "0");

    const fileUrl =
      `https://github.com/Yolo9203/Repository-name-BRI-SLIP-GROUPER/raw/main/output/2026-06-02/CDP%20${cdp4}.pdf`;

    const check = await fetch(fileUrl);

    if (!check.ok) {
      await sendMessage(env, chatId, `Slip CDP ${cdp4} belum ditemukan.`);
      return new Response("OK");
    }

    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        document: fileUrl,
        caption: `✅ Slip CDP ${cdp4}`
      })
    });

    return new Response("OK");
  }
};

async function sendMessage(env, chatId, text) {
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
