import { z } from "zod";

// Keep in sync with public/js/login.js (the browser validates for convenience; the server is the authority).
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128; // bounds Argon2 work per request

const clean = (s) => s.normalize("NFKC").replace(/\p{Cc}/gu, "").trim();

export const emailSchema = z
  .string({ error: "Enter your email address." })
  .transform(clean)
  .pipe(z.string().min(1, "Enter your email address.").max(254, "That email address is too long."))
  .transform((s) => s.toLowerCase())
  .pipe(z.string().email("Enter a valid email address, like name@school.edu."));

export const nameSchema = z
  .string({ error: "Enter your full name." })
  .transform(clean)
  .pipe(z.string().min(2, "Enter your full name.").max(100, "That name is too long."));

export const passwordSchema = z
  .string({ error: "Create a password." })
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`)
  .refine((s) => /[A-Za-z]/.test(s), "Include at least one letter.")
  .refine((s) => /\d/.test(s), "Include at least one number.");

const withConfirm = (shape) =>
  z.object({ ...shape, confirmPassword: z.string({ error: "Confirm your password." }) }).superRefine((d, ctx) => {
    if (d.password !== d.confirmPassword) {
      ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "Passwords do not match." });
    }
    if (d.email && d.password && d.password.toLowerCase() === d.email) {
      ctx.addIssue({ code: "custom", path: ["password"], message: "Your password can't be your email address." });
    }
  });

export const registerSchema = withConfirm({ name: nameSchema, email: emailSchema, password: passwordSchema });
export const resetSchema = withConfirm({ token: z.string().min(10).max(200), password: passwordSchema });
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: "Enter your password." }).min(1, "Enter your password.").max(PASSWORD_MAX),
  remember: z.boolean().optional().default(false),
});
export const forgotSchema = z.object({ email: emailSchema });
export const tokenSchema = z.object({ token: z.string().min(10).max(200) });

/** Parse or throw an HttpError(400) with per-field messages. */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0] ?? "form";
    if (!fields[key]) fields[key] = issue.message;
  }
  throw new HttpError(400, "validation", "Please check the highlighted fields.", fields);
}

export class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
