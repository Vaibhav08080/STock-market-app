import {serve} from "inngest/next"
import {inngest} from "@/lib/inngest/client"
import { sendSignupEmail, SendDailyNewsSummary } from "@/lib/inngest/functions"
export const {GET , PUT , POST}= serve({
    client:inngest,
    functions:[sendSignupEmail, SendDailyNewsSummary]
})