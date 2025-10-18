import { inngest } from "@/lib/inngest/client"
import { PERSONALIZED_WELCOME_EMAIL_PROMPT } from "./prompt"
import { sendwelcomeemail } from "@/lib/nodemailer"
import { getAllUserForNewsEmail } from "../actions/user.action"
import { getWatchlistSymbolsByEmail } from "@/lib/actions/watchlist.actions"
import { getNews } from "@/lib/actions/finnhub.actions"
import { sendDailyNewsEmail } from "@/lib/nodemailer/sendDailyNewsEmail"

export const sendSignupEmail = inngest.createFunction(
  { id: "send-signup-email" },
  { event: "app/user.created" },
  async ({ event, step }) => {
    const UserProfile = `
      -country: ${event.data.country},
      -Investment goals: ${event.data.investmentGoals},
      -Risk Tolerance: ${event.data.riskTolerance},
      -Preferred Industries: ${event.data.preferredIndustry}
    `

    const PROMPT = PERSONALIZED_WELCOME_EMAIL_PROMPT.replace("{{userProfile}}", UserProfile)

    console.log('[INNGEST] Processing user.created event for:', event.data.email);
    
    let introText = "Thanks for joining Signalist! "
    try {
      console.log('[INNGEST] Generating personalized intro with AI...');
      const response = await step.ai.infer("generate-welcome-intro", {
        model: step.ai.models.gemini({ model: "gemini-2.5-flash-lite" }),
        body: {
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: PROMPT,
                },
              ],
            },
          ],
        },
      })
      const part = response.candidates?.[0]?.content?.parts?.[0]
      introText = (part && 'text' in part ? (part as any).text : null) || introText
      console.log('[INNGEST] AI intro generated successfully');
    } catch (e) {
      console.log('[INNGEST] AI generation failed, using default intro');
      // Fallback to default introText if AI fails
    }

    const emailResult = await step.run("send-welcome-email", async () => {
      console.log('[INNGEST] Calling sendwelcomeemail function...');
      const result = await sendwelcomeemail({ email: event.data.email, name: event.data.name, intro: introText });
      console.log('[INNGEST] Email function returned:', result);
      return result;
    });
    
    console.log('[INNGEST] Function completed. Email result:', emailResult);
    return{
        success: emailResult.success,
        message: emailResult.message || "Welcome email sent successfully"
    }
  }
)

export const SendDailyNewsSummary = inngest.createFunction(
    {id: "send-daily-news-summary"},
    [{event:"app/send.daily.news"}, {cron:"0 12 * * *"}],
    async({step}) => {
        const users = await step.run("get-all-users", getAllUserForNewsEmail) as Array<{ id: string; email: string; name: string; country?: string }>
        if(!users || users.length === 0) return { success:false , message:"No users found for email news"}

        // Get watchlist symbols and news per user with graceful fallbacks
        const userNews = await step.run("build-user-news", async () => {
          const results: Record<string, MarketNewsArticle[]> = {}
          const cache = new Map<string, MarketNewsArticle[]>()
          for (const u of users) {
            // Step A: get symbols for user
            const symbols = await getWatchlistSymbolsByEmail(u.email)
            const cleaned = (symbols || []).map((s) => s.trim().toUpperCase()).filter(Boolean)
            const key = cleaned.length ? cleaned.slice().sort().join(",") : "__general__"

            // Step B: get news (round-robin for symbols, fallback to general) with memoization
            let news: MarketNewsArticle[] = []
            if (cache.has(key)) {
              news = cache.get(key) as MarketNewsArticle[]
            } else {
              try {
                news = await getNews(cleaned.length ? cleaned : undefined)
              } catch {
                news = []
              }
              cache.set(key, news)
            }
            results[u.email] = (news || []).slice(0, 6)
          }
          return results
        })

        // Placeholder: Summarize news via AI per user
        const summaries = await step.run("summarize-news", async () => {
          const out: Record<string, string> = {}
          for (const u of users) {
            const items = userNews[u.email] || []
            const summary = items.length
              ? `You have ${items.length} news items today. Top: ${items[0].headline}`
              : "No personalized news today."
            out[u.email] = summary
          }
          return out
        })

        // Placeholder: Send emails
        await step.run("send-daily-news-emails", async () => {
          const results: Array<{ email: string; ok: boolean; message?: string }> = []
          for (const u of users) {
            const _summary = summaries[u.email]
            const _news = userNews[u.email] || []
            if (_news.length === 0) {
              results.push({ email: u.email, ok: true, message: "No news to send" })
              continue
            }
            try {
              const res = await sendDailyNewsEmail(u.email, u.name, _news, _summary)
              results.push({ email: u.email, ok: res.success, message: res.message })
            } catch (e) {
              console.error(`[DAILY NEWS] Failed to send to ${u.email}:`, e)
              results.push({ email: u.email, ok: false, message: "send failed" })
            }
          }
          return { ok: true, results }
        })

        return { success: true }
    }
)