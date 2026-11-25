/* One Resend call, shared by customer and owner emails. The sender comes
   from MOTIONWREN_FROM_EMAIL (FRAME_MOTION_FROM_EMAIL still works), for
   example: MotionWren <hello@send.motionwren.com>. A rejected send (domain
   not verified, bad key) is logged with its reason so it shows in the
   Worker logs. It never throws: an email must never fail a video. */
export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MOTIONWREN_FROM_EMAIL || process.env.FRAME_MOTION_FROM_EMAIL;
  if (!apiKey || !from) {
    console.error("[email] not sent: RESEND_API_KEY or MOTIONWREN_FROM_EMAIL is missing", subject);
    return false;
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text, ...(html ? { html } : {}) }),
    });
    if (!response.ok) console.error("[email] Resend refused the send", response.status, (await response.text().catch(() => "")).slice(0, 300));
    return response.ok;
  } catch (error) {
    console.error("[email] Resend could not be reached", error instanceof Error ? error.message : error);
    return false;
  }
}
