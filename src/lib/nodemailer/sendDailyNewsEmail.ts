import { transporter } from "@/lib/nodemailer"
import { dailyNewsEmailHtml, dailyNewsEmailText } from "@/lib/nodemailer/templates/dailyNewsEmail"

export async function sendDailyNewsEmail(to: string, name: string, news: MarketNewsArticle[], summary: string): Promise<{ success: boolean; message?: string }> {
  const from = `Signalist <${process.env.NODEMAILER_EMAIL}>`
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })

  const html = dailyNewsEmailHtml({ name, date, items: news, summary })
  const text = dailyNewsEmailText({ name, date, items: news, summary })

  try {
    const info = await transporter.sendMail({ from, to, subject: "Your Daily Market News Summary", text, html })
    return { success: true, message: `Email sent: ${info.messageId}` }
  } catch (error) {
    console.error("[sendDailyNewsEmail] Failed:", error)
    return { success: false, message: "Failed to send daily news email" }
  }
}
