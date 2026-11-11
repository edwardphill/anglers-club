// A stand-in for the Messages API for local trip planner tests: streams a canned answer with one
// web search and one citation, and saves each request body to MOCK_LOG.
// Usage: PORT=4999 MOCK_LOG=/tmp/last.json node tests/mock-anthropic.mjs
import http from "node:http";
import { writeFileSync } from "node:fs";

const events = (q) => [
  { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", content: [] } },
  { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"Center Hill Dam generation schedule"}' } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://example.org/center-hill", title: "Center Hill Lake" }] } },
  { type: "content_block_stop", index: 1 },
  { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "**Go to the Caney Fork tomorrow morning.**\n\n**Why**\n- " } },
  { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "No generation is posted before noon" } },
  { type: "content_block_delta", index: 2, delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://example.org/center-hill", title: "Center Hill Lake", cited_text: "..." } } },
  { type: "content_block_stop", index: 2 },
  { type: "content_block_start", index: 3, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 3, delta: { type: "text_delta", text: ".\n- Midges are 16% of the menu ([Fly Picker](https://cfoutdoors.com/x)).\n\n**Flies to bring**\n1. Zebra Midge #18–24\n2. Sowbug\n\nYou asked: " + q.slice(0, 60) } },
  { type: "content_block_stop", index: 3 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 120 } },
  { type: "message_stop" },
];

http.createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  if (process.env.MOCK_LOG) writeFileSync(process.env.MOCK_LOG, raw);
  if (!req.headers["x-api-key"]) { res.writeHead(401, { "content-type": "application/json" }); return res.end('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'); }
  const body = JSON.parse(raw || "{}");
  const last = body.messages?.at(-1)?.content || "";
  const q = String(last).split("</club_data>").pop().trim();
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const ev of events(q)) {
    res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    await new Promise((r) => setTimeout(r, 40));
  }
  res.end();
}).listen(Number(process.env.PORT || 4999), () => console.log("mock anthropic ready"));
