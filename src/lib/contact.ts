export const CONTACT_EMAIL = "office@focusmedia.ro";

export const WHATSAPP_CONTACTS = [
  {
    label: "WhatsApp 1",
    display: "+40 741 139 156",
    phone: "40741139156"
  },
  {
    label: "WhatsApp 2",
    display: "0741 136 929",
    phone: "40741136929"
  }
] as const;

export function whatsappHref(phone: string, message: string) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function emailHref(subject: string, body: string) {
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export const GENERAL_CONTACT_MESSAGE =
  "Buna ziua, doresc mai multe informatii despre portofoliul Focus Media.";
