import { inngest } from "@/lib/inngest/client"
import { PERSONALIZED_WELCOME_EMAIL_PROMPT } from "./prompt"
import { success } from "zod"
import { sendwelcomeemail } from "@/lib/nodemailer"

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