# Open-Meteo MCP server

[![CI](https://github.com/amirhoseinTaghizadeh/open-meteo-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/amirhoseinTaghizadeh/open-meteo-mcp/actions/workflows/ci.yml)

An [MCP](https://modelcontextprotocol.io) server in TypeScript that gives an LLM three weather tools backed by the free [Open-Meteo](https://open-meteo.com) API. It comes with a small React page that talks to the server over MCP, so you can try the tools in a browser.

No API key, no config. One command runs it.

| Tool                | What it does                                                                |
| ------------------- | --------------------------------------------------------------------------- |
| `search_places`     | Find a place by name, get coordinates and timezone.                         |
| `get_forecast`      | Current conditions and a 1 to 16 day forecast for a coordinate.             |
| `compare_locations` | Look up 2 to 5 places at once, average the forecasts, say which is warmest. |

## Run it

With Docker:

```bash
docker compose up --build
```

Or with Node 24:

```bash
npm ci
npm run build
npm start
```

Then open <http://localhost:3000>. The MCP endpoint is `POST /mcp` (Streamable HTTP) and `GET /healthz` is the health check.

For development, run the server and the UI separately so both reload:

```bash
npm run dev        # server on :3000
npm run dev:web    # vite on :5173, proxies /mcp
```

### From Claude Desktop or MCP Inspector

These start the server over stdio. Build first, then point them at `server/dist/stdio.js`:

```json
{
  "mcpServers": {
    "open-meteo": {
      "command": "node",
      "args": ["/absolute/path/to/open-meteo-mcp/server/dist/stdio.js"]
    }
  }
}
```

```bash
npx @modelcontextprotocol/inspector node server/dist/stdio.js
```

## Tools

### `search_places`

| Input   | Type    | Rules                         |
| ------- | ------- | ----------------------------- |
| `query` | string  | required, 2 to 100 characters |
| `count` | integer | 1 to 10, default 5            |

Returns `{ query, results: Place[] }`. No match is not an error, just an empty list.

### `get_forecast`

| Input       | Type    | Rules                               |
| ----------- | ------- | ----------------------------------- |
| `latitude`  | number  | required, -90 to 90                 |
| `longitude` | number  | required, -180 to 180               |
| `days`      | integer | 1 to 16, default 3                  |
| `units`     | enum    | `celsius` (default) or `fahrenheit` |

Returns `{ location, units, current, daily[] }` with readable condition labels ("Partly cloudy"). Fahrenheit also switches wind to mph and precipitation to inches.

### `compare_locations`

| Input    | Type     | Rules                                 |
| -------- | -------- | ------------------------------------- |
| `places` | string[] | required, 2 to 5 names, no duplicates |
| `days`   | integer  | 1 to 7, default 3                     |
| `units`  | enum     | `celsius` (default) or `fahrenheit`   |

Places are looked up concurrently. Each row has its own `status` (`ok`, `not_found` or `failed`), so one bad name doesn't fail the others. The call only errors when nothing could be answered. Ties are named in the text.

Every tool returns a short text block for people and LLMs plus `structuredContent` matching its `outputSchema`.

## How it's built

```
stdio  ──▶ server/src/stdio.ts ─┐
                                ├─▶ mcp.ts ─▶ tools/* ─▶ openmeteo/client.ts ─▶ Open-Meteo
HTTP   ──▶ server/src/http.ts ──┘
           (also serves web/dist)
```

- `openmeteo/client.ts` builds the request, caches responses for a minute, times out after 5s, validates the JSON with Zod and turns every failure into one `OpenMeteoError` with a readable message.
- `tools/*.ts` are plain objects: Zod input and output schemas, an `execute`, and a `summarize` for the text block. All validation rules live in the schemas, so clients can see them in `tools/list`.
- `mcp.ts` registers the tools and decides what the client sees: a known failure becomes `isError` with a sentence, a bug is logged to stderr and answered with a generic message.
- `http-server.ts` is a plain `node:http` server: `POST /mcp`, `/healthz`, static files. No Express needed.
- `web/` is a real MCP client (`@modelcontextprotocol/client`). Forms are generated from the tool schemas, so adding a tool needs no UI change.

### Guardrails

Every tool call goes through, in order:

1. Host and Origin check (the SDK's DNS-rebinding guard, HTTP only).
2. Only `POST` on `/mcp`, and a bearer token if `MCP_BEARER_TOKEN` is set.
3. Input validation against the tool's schema, before the handler runs.
4. A rate limit for the whole process (`TOOL_CALLS_PER_MINUTE`). Over the limit, the LLM gets a sentence saying how long to wait.
5. The tool itself. Upstream failures become readable `isError` results.
6. Output validation against `outputSchema`.
7. One audit line per call on stderr:

```json
{
  "event": "tool_call",
  "ts": "2026-09-10T09:14:02.118Z",
  "tool": "compare_locations",
  "args": { "places": ["Lisbon", "Porto"], "days": 3, "units": "celsius" },
  "outcome": "ok",
  "durationMs": 412
}
```

## Configuration

| Variable                | Default                           | Meaning                                             |
| ----------------------- | --------------------------------- | --------------------------------------------------- |
| `PORT`                  | `3000`                            | Listen port                                         |
| `HOST`                  | `127.0.0.1` (`0.0.0.0` in Docker) | Bind address                                        |
| `ALLOWED_HOSTS`         | `localhost,127.0.0.1`             | Accepted `Host` and `Origin` values                 |
| `STATIC_DIR`            | `web/dist`                        | Built UI directory                                  |
| `TOOL_CALLS_PER_MINUTE` | `60`                              | Rate limit across the process, `0` disables         |
| `MCP_BEARER_TOKEN`      | unset                             | When set, `/mcp` requires `Authorization: Bearer …` |

## Tests

```bash
npm test         # 47 tests, no network
npm run lint
npm run typecheck
```

Open-Meteo is stubbed, the protocol tests use the SDK's in-memory transport, and the HTTP tests start the real server on a random port. CI runs all of it plus a Docker build.
