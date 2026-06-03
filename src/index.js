export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      const r = await fetch(
        "https://api.github.com/repos/Yolo9203/Repository-name-BRI-SLIP-GROUPER/contents/output",
        {
          headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "cdp-slip-worker"
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

    return new Response("OK");
  }
};
