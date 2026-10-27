import nodemailer from "nodemailer";

/**
 * Sends transactional mail over SMTP. Without SMTP settings (development only) messages are
 * printed to the console and kept in `mailer.outbox` so you can click the link or tests can read it.
 */
export function createMailer(config) {
  const outbox = [];
  const smtp = config.smtp;
  const transport = smtp.host
    ? nodemailer.createTransport({
        host: smtp.host, port: smtp.port, secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      })
    : null;

  if (!transport && config.isProd) {
    console.warn("[mail] SMTP_HOST is not set: verification and reset emails will NOT be delivered.");
  }

  return {
    outbox,
    async send({ to, subject, text }) {
      if (!transport) {
        if (!config.isProd) {
          outbox.push({ to, subject, text });
          if (outbox.length > 50) outbox.shift();
          console.log(`\n[mail:dev] To: ${to}\nSubject: ${subject}\n${text}\n`);
        }
        return;
      }
      await transport.sendMail({ from: smtp.from, to, subject, text });
    },
  };
}
