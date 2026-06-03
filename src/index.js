export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return new Response("CDP Slip Worker aktif");
    }

    const update = await request.json();

    const chatId = update.message?.chat?.id;
    const text = update.message?.text || "";

    if (!chatId) {
      return new Response("OK");
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
