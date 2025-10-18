import nodemailer from "nodemailer"
import { WELCOME_EMAIL_TEMPLATE } from "./template"
export const transporter = nodemailer.createTransport({
    service:"gmail",
    auth:{
        user:process.env.NODEMAILER_EMAIL,
        pass:process.env.NODEMAILER_PASSWORD

    }
})

export const sendwelcomeemail = async ({email , name , intro}: WelcomeEmailData)=>{
    console.log('[EMAIL] Starting to send welcome email...');
    console.log('[EMAIL] Recipient:', email);
    console.log('[EMAIL] Name:', name);
    const htmltemplate = WELCOME_EMAIL_TEMPLATE.replace("{{name}}", name).replace("{{intro}}", intro)
    const mailOptions={
        from: `Signalist <${process.env.NODEMAILER_EMAIL}>`,
        to:email,
        subject:"Welcome to Signalist - your stock market toolkit is ready",
        text:"Thanks for joining Signalist! ",
        html:htmltemplate
    }

    try{
        console.log('[EMAIL] Sending email via Gmail SMTP...');
        const info = await transporter.sendMail(mailOptions)
        console.log('[EMAIL] ✅ Email sent successfully!');
        console.log('[EMAIL] Message ID:', info.messageId);
        console.log('[EMAIL] Response:', info.response);
        console.log('[EMAIL] Accepted recipients:', info.accepted);
        return {success:true , message: `Email sent: ${info.messageId}`}
    }catch(error){
        console.error('[EMAIL] ❌ Failed to send email');
        console.error('[EMAIL] Error details:', error);
        return {success:false , message: "Failed to send email"}
    }
}