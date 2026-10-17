/**
 * Public privacy + acceptable-use page for Hub linking.
 * Served without RapidAPI proxy secret so Hub consumers can open it.
 */

const BODY = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MeetZone — Privacy &amp; Acceptable Use</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; line-height: 1.5; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; color: #111; }
    h1 { font-size: 1.5rem; }
    h2 { font-size: 1.15rem; margin-top: 1.75rem; }
    ul { padding-left: 1.25rem; }
    code { font-size: 0.9em; background: #f4f4f5; padding: 0.1em 0.35em; border-radius: 4px; }
    .meta { color: #555; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>MeetZone — Privacy &amp; Acceptable Use</h1>
  <p class="meta">Product: MeetZone — Timezone Meeting Overlap API · Version 0.1.0 · Updated 2026-09-23</p>

  <h2>What MeetZone does</h2>
  <p>MeetZone computes overlapping meeting windows across public IANA timezones using <strong>deterministic scheduling math</strong>. Inputs are timezone identifiers, civil dates, and local clock times (work hours / duration). Outputs are UTC intervals, per-zone local times, and an optional ICS snippet.</p>

  <h2>What MeetZone does not do</h2>
  <ul>
    <li>Does <strong>not</strong> connect to Google Calendar, Microsoft Outlook, Apple Calendar, or any private calendar</li>
    <li>Does <strong>not</strong> scrape calendars, free/busy feeds, email, or contacts</li>
    <li>Does <strong>not</strong> require OAuth or end-user identity</li>
    <li>Does <strong>not</strong> infer personal availability beyond the zones and windows <strong>you</strong> supply</li>
    <li>Does <strong>not</strong> sell personal data (none is required to use the API)</li>
  </ul>

  <h2>Data you should send</h2>
  <ul>
    <li>IANA timezone IDs (e.g. <code>America/Denver</code>)</li>
    <li>Dates (<code>YYYY-MM-DD</code>) and local <code>HH:mm</code> work windows</li>
    <li>Meeting duration in minutes</li>
  </ul>

  <h2>Data you should not send</h2>
  <ul>
    <li>Names, emails, phone numbers, or other PII (not needed)</li>
    <li>Calendar event contents, attendee lists, or private notes</li>
    <li>Access tokens or credentials for third-party calendar systems</li>
  </ul>

  <h2>Data sources</h2>
  <p>Timezone conversions use the <strong>public IANA Time Zone Database</strong> as exposed by the JavaScript runtime’s ICU / <code>Intl</code> implementation on Cloudflare Workers. MeetZone ships a curated city→IANA search index for discovery; unknown-but-valid IANA ids are still accepted when <code>Intl</code> validates them.</p>

  <h2>Logging &amp; retention (Day-1 posture)</h2>
  <ul>
    <li>Provider infrastructure (Cloudflare / RapidAPI) may retain standard request metadata (timestamps, status codes, IP via proxy, rate-limit counters) for abuse prevention and billing.</li>
    <li>Do not put secrets or PII in query strings or JSON bodies.</li>
    <li>Daily unique visitors (homepage and the free MCP endpoint at <code>/mcp</code> only): a salted, daily-rotating hash of your network (IP, IPv6 grouped by /64) is kept for up to 9 days to count unique visitors per day. No IP address, user agent or request content is stored. Fleet, monitoring and health-check traffic is not counted.</li>
    <li>MeetZone application logic does not persist request bodies to a product database in Day-1 MVP.</li>
  </ul>

  <h2>Acceptable use</h2>
  <p><strong>Allowed:</strong> scheduling automations, SaaS demo/interview slot suggestions, internal bots, education, research, and legitimate product features built on public timezone math.</p>
  <p><strong>Prohibited:</strong></p>
  <ul>
    <li>Attempting to reconstruct private calendars or surveil individuals</li>
    <li>Abuse, credential stuffing, or bypassing RapidAPI rate limits</li>
    <li>High-volume scraping of the API beyond plan quotas</li>
    <li>Using the service for unlawful activity</li>
  </ul>

  <h2>Contact</h2>
  <p>Privacy and support questions: <a href="mailto:digitalpromohub.support@gmail.com">digitalpromohub.support@gmail.com</a>. You can also reach us through RapidAPI Hub messaging.</p>
</body>
</html>`;

export function handlePrivacy(): Response {
  return new Response(BODY, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
