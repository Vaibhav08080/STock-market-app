import { formatTimeAgo } from "@/lib/utils"

export function dailyNewsEmailHtml(params: { name: string; date: string; items: MarketNewsArticle[]; summary: string }) {
  const { name, date, items, summary } = params
  const articles = items
    .map(
      (a) => `
      <tr>
        <td style="padding:12px 0; border-bottom:1px solid #eee;">
          <div style="font-weight:600; font-size:16px; line-height:1.4;">
            <a href="${a.url}" style="color:#0ea5e9; text-decoration:none;" target="_blank" rel="noopener noreferrer">${escapeHtml(
              a.headline
            )}</a>
          </div>
          <div style="color:#666; font-size:13px; margin:6px 0;">${escapeHtml(a.source)} • ${formatTimeAgo(a.datetime)}</div>
          <div style="color:#444; font-size:14px; line-height:1.5;">${escapeHtml(a.summary)}</div>
        </td>
      </tr>`
    )
    .join("")

  return `
  <!doctype html>
  <html>
    <body style="margin:0; padding:0; background:#f8fafc; font-family:Arial, Helvetica, sans-serif;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="max-width:640px; margin:0 auto; padding:20px;">
        <tr>
          <td>
            <table width="100%" style="background:#ffffff; border-radius:8px; overflow:hidden;">
              <tr>
                <td style="background:#0ea5e9; color:#ffffff; padding:16px 24px;">
                  <div style="font-weight:700; font-size:18px; letter-spacing:0.2px;">Signalist</div>
                  <div style="opacity:0.9; font-size:12px;">Your Daily Market News</div>
                </td>
              </tr>
              <tr>
                <td style="padding:24px;">
                  <h2 style="margin:0 0 12px; font-size:20px;">Daily News Summary</h2>
                  <div style="color:#64748b; font-size:13px; margin-bottom:16px;">${date}</div>
                  <p style="font-size:14px; color:#0f172a;">Hi ${escapeHtml(name)},</p>
                  <p style="font-size:14px; color:#0f172a;">${escapeHtml(summary)}</p>
                </td>
              </tr>
              ${articles}
              <tr>
                <td style="padding:16px 24px; color:#94a3b8; font-size:12px; border-top:1px solid #eef2f7;">
                  You are receiving this because you have a Signalist account.
                  <br/>
                  Manage your <a href="https://signalist.app/account/preferences" style="color:#0ea5e9; text-decoration:none;">email preferences</a> or <a href="https://signalist.app/account/unsubscribe" style="color:#0ea5e9; text-decoration:none;">unsubscribe</a>.
                  <div style="margin-top:8px;">Signalist Inc., 123 Market St, San Francisco, CA</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>`
}

export function dailyNewsEmailText(params: { name: string; date: string; items: MarketNewsArticle[]; summary: string }) {
  const { name, date, items, summary } = params
  const lines = [
    `Daily News Summary - ${date}`,
    `Hi ${name},`,
    summary,
    "",
    ...items.map((a, i) => `${i + 1}. ${a.headline} (${a.source}) - ${a.url}`),
    "",
    "You are receiving this because you have a Signalist account. To manage preferences, visit your account settings.",
  ]
  return lines.join("\n")
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;")
}
