import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/** Escape text for interpolation into the HTML body. */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Send an invitation email via Resend.
//
// Internal, and scheduled by `invitations.sendEmailInvitation` with values the
// server derived itself. It used to be a public HTTP action taking `to`,
// `inviteUrl` and `message` from the request body and pasting them unescaped
// into the HTML — an open relay for phishing mail sent under Selah's name. (It
// was also never routed in http.ts, so the client's POST 404'd and no invite
// email was ever sent.)
export const sendInviteEmail = internalAction({
    args: {
        to: v.string(),
        churchName: v.string(),
        inviterName: v.string(),
        inviteUrl: v.string(),
        message: v.optional(v.string()),
        expiresAt: v.optional(v.string()),
    },
    handler: async (_ctx, args) => {
        const RESEND_API_KEY = process.env.RESEND_API_KEY;
        if (!RESEND_API_KEY) {
            // Not an error worth retrying: the admin still has the link to share.
            console.warn("[emails] RESEND_API_KEY not configured; invite email not sent");
            return { sent: false };
        }

        const { to, expiresAt } = args;
        // Raw values for the plain-text part and the subject line; escaped
        // copies for the HTML body.
        const text = {
            churchName: args.churchName,
            inviterName: args.inviterName,
            message: args.message,
        };
        const churchName = escapeHtml(args.churchName);
        const inviterName = escapeHtml(args.inviterName);
        const inviteUrl = escapeHtml(args.inviteUrl);
        const message = args.message ? escapeHtml(args.message) : undefined;

        // Format expiration date
        const expirationText = expiresAt
            ? `This invitation will expire on ${new Date(expiresAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })}.`
            : "This invitation does not expire.";

        // Build email HTML
        const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>You're invited to join ${churchName} on Selah</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; margin-top: 40px; margin-bottom: 40px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
            <!-- Header -->
            <tr>
                <td style="padding: 40px 40px 20px 40px; text-align: center;">
                    <div style="display: inline-block; width: 48px; height: 48px; background: linear-gradient(135deg, #0d9488, #0f766e); border-radius: 12px; line-height: 48px;">
                        <span style="color: white; font-size: 24px;">S</span>
                    </div>
                    <h1 style="margin: 20px 0 10px 0; color: #1a1a1a; font-size: 24px; font-weight: 600;">
                        You've been invited!
                    </h1>
                    <p style="margin: 0; color: #666; font-size: 16px;">
                        ${inviterName} has invited you to join <strong>${churchName}</strong> on Selah
                    </p>
                </td>
            </tr>

            ${message ? `
            <!-- Personal Message -->
            <tr>
                <td style="padding: 0 40px;">
                    <div style="background-color: #f8f9fa; border-left: 4px solid #0d9488; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
                        <p style="margin: 0; color: #444; font-style: italic; font-size: 15px; line-height: 1.6;">
                            "${message}"
                        </p>
                    </div>
                </td>
            </tr>
            ` : ''}

            <!-- CTA Button -->
            <tr>
                <td style="padding: 20px 40px 40px 40px; text-align: center;">
                    <a href="${inviteUrl}" style="display: inline-block; background: linear-gradient(135deg, #0d9488, #0f766e); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                        Join ${churchName}
                    </a>
                    <p style="margin: 20px 0 0 0; color: #888; font-size: 13px;">
                        Or copy and paste this link into your browser:
                    </p>
                    <p style="margin: 8px 0 0 0; color: #0d9488; font-size: 13px; word-break: break-all;">
                        ${inviteUrl}
                    </p>
                </td>
            </tr>

            <!-- Expiration Notice -->
            <tr>
                <td style="padding: 0 40px 40px 40px; text-align: center;">
                    <p style="margin: 0; color: #888; font-size: 13px;">
                        ${expirationText}
                    </p>
                </td>
            </tr>

            <!-- Footer -->
            <tr>
                <td style="padding: 30px 40px; background-color: #f8f9fa; border-top: 1px solid #eee; text-align: center;">
                    <p style="margin: 0 0 10px 0; color: #666; font-size: 14px;">
                        <strong>Selah</strong> - AI-Powered Worship Presentation
                    </p>
                    <p style="margin: 0; color: #999; font-size: 12px;">
                        Empowering church media teams with intelligent scripture detection
                    </p>
                </td>
            </tr>
        </table>
    </body>
    </html>
    `;

        // Plain text version
        const textContent = `
You've been invited to join ${text.churchName} on Selah!

${text.inviterName} has invited you to join ${text.churchName}'s media team on Selah.

${text.message ? `Personal message: "${text.message}"\n` : ''}

Click the link below to accept the invitation:
${args.inviteUrl}

${expirationText}

---
Selah - AI-Powered Worship Presentation
`.trim();

        const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${RESEND_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: process.env.RESEND_FROM_EMAIL || "Selah <noreply@selah.app>",
                to: [to],
                subject: `${text.inviterName} invited you to join ${text.churchName} on Selah`,
                html: htmlContent,
                text: textContent,
            }),
        });

        if (!response.ok) {
            console.error("[emails] Resend API error:", response.status, await response.text());
            return { sent: false };
        }
        return { sent: true };
    },
});
