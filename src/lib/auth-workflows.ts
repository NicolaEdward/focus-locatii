import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authActionTokenHash, findUsableAuthActionToken, issueAuthActionToken } from "@/lib/auth-action-tokens";
import { hashPassword } from "@/lib/auth";
import { assertRoleAssignmentAllowed, isUserRole, type UserRole } from "@/lib/rbac";
import { authEmailCapability, authLink, sendAuthEmail } from "@/lib/transactional-email";
import { revokeAllAuthSessions } from "@/lib/auth-sessions";

const passwordSchema = z.string().min(12).max(128);
const inviteSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  name: z.string().trim().min(2).max(120),
  role: z.string().refine(isUserRole, "Rol invalid.").transform((value) => value as UserRole)
});

export async function createUserInvite(input: unknown, actor: { id: string; role: UserRole }) {
  const parsed = inviteSchema.parse(input);
  assertRoleAssignmentAllowed(actor.role, null, parsed.role);
  const existing = await prisma.user.findUnique({ where: { email: parsed.email }, select: { id: true } });
  if (existing) throw new Error("Exista deja un cont cu acest email.");
  const synthetic = syntheticAuthFlowAllowed();
  if (!authEmailCapability().enabled && !synthetic) throw new Error("Serviciul de email pentru invitatii nu este configurat.");

  const issued = await issueAuthActionToken({
    type: "USER_INVITE",
    email: parsed.email,
    name: parsed.name,
    role: parsed.role,
    createdByUserId: actor.id,
    ttlSeconds: 72 * 60 * 60
  });
  const link = authLink("/admin/accepta-invitatie", issued.token);
  try {
    if (authEmailCapability().enabled) {
      await sendAuthEmail({
        to: parsed.email,
        subject: "Invitatie Focus Media OOH",
        operation: "auth.invite",
        html: emailTemplate(
          "Invitatie in Focus Media OOH",
          `Ai primit acces in aplicatie. Invitatia expira in 72 de ore.<br/><br/><a href="${escapeHtml(link)}">Seteaza parola</a>`
        )
      });
    }
  } catch (error) {
    await prisma.authActionToken.updateMany({
      where: { type: "USER_INVITE", tokenHash: authActionTokenHash("USER_INVITE", issued.token), usedAt: null },
      data: { usedAt: new Date() }
    });
    throw error;
  }
  return { expiresAt: issued.expiresAt, syntheticLink: synthetic ? link : null };
}

export async function acceptUserInvite(token: string, passwordInput: unknown) {
  const password = passwordSchema.parse(passwordInput);
  const invitation = await findUsableAuthActionToken("USER_INVITE", token);
  if (!invitation?.email || !invitation.name || !invitation.role || !isUserRole(invitation.role)) {
    throw new Error("Invitatia este invalida sau a expirat.");
  }
  const passwordHash = await hashPassword(password);
  return prisma.$transaction(async (tx) => {
    const consumed = await tx.authActionToken.updateMany({
      where: { id: invitation.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() }
    });
    if (consumed.count !== 1) throw new Error("Invitatia a fost deja utilizata.");
    const existing = await tx.user.findUnique({ where: { email: invitation.email! }, select: { id: true } });
    if (existing) throw new Error("Exista deja un cont cu acest email.");
    return tx.user.create({
      data: {
        email: invitation.email!,
        name: invitation.name!,
        role: invitation.role as UserRole,
        passwordHash
      },
      select: { id: true, email: true, name: true, role: true, tokenVersion: true }
    });
  });
}

export async function requestPasswordReset(emailInput: unknown) {
  const email = z.string().trim().email().transform((value) => value.toLowerCase()).parse(emailInput);
  const capability = authEmailCapability();
  const synthetic = syntheticAuthFlowAllowed();
  if (!capability.enabled && !synthetic) throw new Error("AUTH_EMAIL_NOT_CONFIGURED");
  const user = await prisma.user.findFirst({ where: { email, active: true }, select: { id: true, email: true } });
  if (!user) return { syntheticLink: null };

  const issued = await issueAuthActionToken({ type: "PASSWORD_RESET", userId: user.id, ttlSeconds: 60 * 60 });
  const link = authLink("/admin/resetare-parola", issued.token);
  try {
    if (capability.enabled) {
      await sendAuthEmail({
        to: user.email,
        subject: "Resetare parola Focus Media OOH",
        operation: "auth.password.reset.request",
        html: emailTemplate(
          "Resetare parola",
          `Linkul de resetare este valabil 60 de minute si poate fi folosit o singura data.<br/><br/><a href="${escapeHtml(link)}">Reseteaza parola</a>`
        )
      });
    }
  } catch (error) {
    await prisma.authActionToken.updateMany({
      where: { type: "PASSWORD_RESET", tokenHash: authActionTokenHash("PASSWORD_RESET", issued.token), usedAt: null },
      data: { usedAt: new Date() }
    });
    throw error;
  }
  return { syntheticLink: synthetic ? link : null };
}

export async function resetPasswordWithToken(token: string, passwordInput: unknown) {
  const password = passwordSchema.parse(passwordInput);
  const reset = await findUsableAuthActionToken("PASSWORD_RESET", token);
  if (!reset?.userId) throw new Error("Linkul de resetare este invalid sau a expirat.");
  const passwordHash = await hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    const consumed = await tx.authActionToken.updateMany({
      where: { id: reset.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() }
    });
    if (consumed.count !== 1) throw new Error("Linkul a fost deja utilizat.");
    return tx.user.update({
      where: { id: reset.userId! },
      data: { passwordHash, tokenVersion: { increment: 1 } },
      select: { id: true, email: true, name: true, role: true, tokenVersion: true }
    });
  });
  await revokeAllAuthSessions(user.id);
  return user;
}

export function syntheticAuthFlowAllowed() {
  return process.env.APP_ENV === "preview" && process.env.ALLOW_SYNTHETIC_SEED === "true";
}

function emailTemplate(title: string, body: string) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;color:#071827"><h1 style="font-size:24px">${escapeHtml(title)}</h1><p style="line-height:1.6">${body}</p><p style="margin-top:32px;color:#52606d;font-size:12px">Daca nu ai solicitat aceasta actiune, ignora mesajul.</p></div>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]!));
}
