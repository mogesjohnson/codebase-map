import { createServer } from "node:http";

/**
 * Start a mock Ollama on 127.0.0.1:<random port>. `handler(body, res)` answers /api/generate;
 * the default replies with a fixed summary. Returns { url, requests, close }.
 */
export async function mockOllama(handler) {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ method: req.method, path: req.url, body });
      if (req.url !== "/api/generate") { res.writeHead(404).end(); return; }
      if (handler) return handler(body, res);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: body.model, response: `Summary of ${body.prompt.match(/Module path: (.*)/)[1]}.`, done: true }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

/** A URL nothing listens on: bind port 0, read the port, close it. */
export async function deadUrl() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return `http://127.0.0.1:${port}`;
}
