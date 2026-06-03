export default {
  async fetch(request, env) {

    if (request.method === "GET") {
      return new Response("CDP Slip Worker aktif");
    }

    return new Response("POST diterima");
  }
};
