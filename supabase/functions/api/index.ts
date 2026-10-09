// Supabase Edge Function: кабинет сообщества (вход, анкеты, календарь).
// Тот же обработчик, что проверяется тестами в Node, запускается здесь через
// небольшой адаптер Request → req/res.
import { Buffer } from "node:buffer";
import process from "node:process";

globalThis.Buffer ??= Buffer;
globalThis.process ??= process;

const { default: handler } = await import("../../../lib/api.js");

// Сессия передаётся заголовком, а не cookie, поэтому открывать API для любых
// сайтов безопасно: без токена из кабинета изменить ничего нельзя.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Max-Age": "86400",
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  const url = new URL(request.url);
  let body;
  if (request.method === "POST") {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (reader) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 300000) {
        await reader.cancel();
        return Response.json({ error: "Слишком большой запрос." }, { status: 413, headers: cors });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    body = new TextDecoder().decode(bytes);
  }
  const req = {
    method: request.method,
    headers: Object.fromEntries(
      [...request.headers].map(([k, v]) => [k.toLowerCase(), v]),
    ),
    query: Object.fromEntries(url.searchParams),
    body,
  };
  return await new Promise<Response>((resolve) => {
    const headers: Record<string, string> = { ...cors };
    const res = {
      statusCode: 200,
      setHeader: (name: string, value: string) => (headers[name] = value),
      end: (body: string) =>
        resolve(new Response(body, { status: res.statusCode, headers })),
    };
    void handler(req, res);
  });
});
