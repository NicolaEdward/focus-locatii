import { Mail, MessageCircle } from "lucide-react";
import { CONTACT_EMAIL, emailHref, WHATSAPP_CONTACTS, whatsappHref } from "@/lib/contact";

export function ContactButtons({
  message,
  subject,
  className = "grid gap-2 sm:grid-cols-3",
  buttonClassName = "focus-button",
  emailLabel = "Email"
}: {
  message: string;
  subject: string;
  className?: string;
  buttonClassName?: string;
  emailLabel?: string;
}) {
  return (
    <div className={className}>
      <a className={buttonClassName} href={emailHref(subject, message)}>
        <Mail size={20} />
        {emailLabel}
      </a>
      {WHATSAPP_CONTACTS.map((contact) => (
        <a
          key={contact.phone}
          className={buttonClassName}
          href={whatsappHref(contact.phone, message)}
          target="_blank"
          rel="noreferrer"
          title={`${contact.label}: ${contact.display}`}
        >
          <MessageCircle size={20} />
          {contact.label}
        </a>
      ))}
    </div>
  );
}

export function ContactInlineLinks({
  message,
  subject,
  compact = false
}: {
  message: string;
  subject: string;
  compact?: boolean;
}) {
  return (
    <>
      <a className="focus-button secondary" href={emailHref(subject, message)}>
        <Mail size={18} />
        {compact ? "Email" : CONTACT_EMAIL}
      </a>
      {WHATSAPP_CONTACTS.map((contact) => (
        <a
          key={contact.phone}
          className="focus-button secondary"
          href={whatsappHref(contact.phone, message)}
          target="_blank"
          rel="noreferrer"
          title={`${contact.label}: ${contact.display}`}
        >
          <MessageCircle size={18} />
          {compact ? contact.label : contact.display}
        </a>
      ))}
    </>
  );
}
