# MeetZone

Find meeting times that overlap working hours across IANA time zones, DST-aware. Free tier.

## Live service

- Web app and API: https://meetzone-api.mike-tusa.workers.dev/
- Pricing: https://rapidapi.com/miketusa/api/meetzone-timezone-meeting-overlap-api
- Support: digitalpromohub.support@gmail.com

## Use it from an AI assistant (MCP)

MeetZone is a remote MCP server (Streamable HTTP) at `https://meetzone-api.mike-tusa.workers.dev/mcp`. Tools: `find_meeting_overlap`, `search_timezones`.

Cursor and Windsurf accept this config:

```json
{
  "mcpServers": {
    "meetzone": {
      "type": "http",
      "url": "https://meetzone-api.mike-tusa.workers.dev/mcp"
    }
  }
}
```

Cline (MCP Servers > Remote Servers, or `cline_mcp_settings.json`) needs `"type": "streamableHttp"`:

```json
{
  "mcpServers": {
    "meetzone": {
      "type": "streamableHttp",
      "url": "https://meetzone-api.mike-tusa.workers.dev/mcp"
    }
  }
}
```

Claude Desktop: open Settings > Connectors, choose "Add custom connector" and paste `https://meetzone-api.mike-tusa.workers.dev/mcp`. Or, for clients that only support local (stdio) servers, use the mcp-remote bridge: `npx mcp-remote https://meetzone-api.mike-tusa.workers.dev/mcp`.

VS Code uses a `servers` key instead of `mcpServers`.

The `server.json` file is the [MCP Registry](https://registry.modelcontextprotocol.io) manifest for this server.

## Run your own copy

Requires Node.js 22+ and a Cloudflare account.

```bash
npm install
npx wrangler@4 dev      # local dev server
```

`wrangler.toml` is a template: create your own KV namespaces / D1 databases / rate-limit namespaces and replace the `<PLACEHOLDER>` values before `npx wrangler@4 deploy`. Any secrets the Worker reads go in `wrangler secret put` (or `.dev.vars` locally), never in the repo.

Optional Worker secrets (leave unset if you do not need them): `RAPIDAPI_PROXY_SECRET` (only needed if you sell the API through RapidAPI; it must match the X-RapidAPI-Proxy-Secret header RapidAPI adds).

## License

MIT (c) Digital Promo Hub. See [LICENSE](LICENSE).
