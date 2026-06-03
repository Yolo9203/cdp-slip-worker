export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      const tokenStatus = env.BOT_TOKEN ? "BOT_TOKEN TERBACA" : "BOT_TOKEN TIDAK TERBACA";
      return new Response("CDP Slip Worker aktif\n" + tokenStatus);
    }

    const update = await request.json();
    const chatId = update.message?.chat?.id;
    const text = update.message?.text || "";

    if (!chatId) {
      return new Response("OK");
    }

    if (!env.BOT_TOKEN) {
      return new Response("BOT_TOKEN tidak ada");
    }

    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: `Worker menerima pesan: ${text}`
      })
    });

    return new Response("OK");
  }
};
