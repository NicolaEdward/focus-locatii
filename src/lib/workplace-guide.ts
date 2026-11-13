import { ROLE_LABELS, type UserRole } from "@/lib/rbac";

export const WORKPLACE_GUIDE_VERSION = 1;

export type WorkplaceStep = {
  id: string;
  title: string;
  description: string;
  evidence: string;
  href: string;
  actionLabel: string;
};

const security: WorkplaceStep = {
  id: "account-security",
  title: "Verifică accesul și securitatea contului",
  description: "Folosește contul tău, verifică rolul primit și configurează autentificarea în doi pași. Cere responsabilului accesul lipsă; nu folosi contul unui coleg.",
  evidence: "Știi ce portofoliu îți este alocat, cum te autentifici și cui raportezi o problemă de acces.",
  href: "/admin/securitate",
  actionLabel: "Securitatea contului",
};

const sales: WorkplaceStep[] = [
  { id: "sales-brief", title: "Pornește de la nevoia clientului", description: "Caută firma după nume sau CUI înainte de a crea un prospect. Înregistrează persoana de contact, obiectivul, zona, perioada și următoarea acțiune. Pregătește oferta din dosarul oportunității.", evidence: "Oportunitatea are responsabil, brief și următorul contact. Nu ai creat un duplicat și nu ai marcat o vânzare înainte de confirmare.", href: "/admin/crm?view=opportunities", actionLabel: "Oportunități" },
  { id: "sales-availability", title: "Alege locațiile pentru întreaga perioadă", description: "Completează prima și ultima zi a campaniei, apoi caută locații potrivite. O locație liberă astăzi poate fi ocupată în perioada cerută. Continuă cu selecția în oferta comercială.", evidence: "Fiecare locație propusă are disponibilitatea verificată pe interval; avertizările și datele necunoscute sunt explicate clientului.", href: "/admin/selectie-locatii", actionLabel: "Alege locațiile" },
  { id: "sales-offer", title: "Pregătește și verifică oferta", description: "Verifică firma contractantă, moneda, tariful negociat și termenii. Urmează aprobările cerute înainte de trimitere sau blocarea locațiilor. O ciornă de ofertă nu rezervă inventarul.", evidence: "Poți identifica versiunea exactă a ofertei, totalul, aprobarea și perioada propusă.", href: "/admin/commercial-quotes", actionLabel: "Oferte și aprobări" },
  { id: "sales-follow-up", title: "Închide fiecare discuție cu un pas următor", description: "Notează rezultatul contactului și programează următoarea acțiune. Verifică agenda zilnică, ofertele în așteptare și blocările care expiră. Închirierea confirmată se face numai în limita drepturilor tale.", evidence: "Ai o dată, o acțiune și un responsabil pentru fiecare oportunitate activă.", href: "/admin/crm?view=today", actionLabel: "Contactele de urmărit" },
  { id: "sales-contract", title: "Urmărește contractul până la execuție și încasare", description: "În campanie verifică închirierile, documentele, montajul și facturile permise portofoliului tău. Semnalează diferențele față de contract; prețul sau perioada se corectează numai cu dovadă și data efectivă corectă.", evidence: "Poți găsi contractul și locațiile, responsabilul montajului, următoarea scadență și eventualele neconcordanțe.", href: "/admin/campanii", actionLabel: "Campanii și închirieri" },
];

const finance: WorkplaceStep[] = [
  { id: "finance-client", title: "Verifică identitatea și firma emitentă", description: "Verifică CUI-ul, denumirea clientului, firma emitentă și moneda înainte de înregistrare. Nu uni automat companii doar pentru că au nume asemănătoare.", evidence: "Factura poate fi atribuită unei entități și unui client fără presupuneri.", href: "/admin/clienti", actionLabel: "Datele clienților" },
  { id: "finance-import", title: "Importă prin previzualizare și verificare", description: "Selectează sursa și firma corecte. Citește previzualizarea, duplicatele și documentele care necesită analiză înainte de confirmare. Un status «plătit» dintr-un export nu inventează o încasare bancară.", evidence: "Poți explica ce s-a importat, ce a fost omis și ce a rămas de verificat.", href: "/admin/financiar/reconciliere", actionLabel: "Import și reconciliere" },
  { id: "finance-receipts", title: "Leagă încasările de documentele corecte", description: "Verifică plătitorul, contul, moneda, data și referința. Tratează separat avansurile, supraplățile și documentele negative neatribuite; nu forța o potrivire ambiguă.", evidence: "Soldul și încasările au o sursă identificabilă; excepțiile rămân vizibile.", href: "/admin/financiar/incasari", actionLabel: "Facturi și încasări" },
  { id: "finance-allocation", title: "Alocă veniturile pe campanii", description: "Leagă sumele de campaniile corespunzătoare fără a amesteca firme sau monede. Cere verificarea unei alocări care nu poate fi justificată prin documente.", evidence: "Raportarea pe campanie poate fi urmărită înapoi până la factură și încasare.", href: "/admin/financiar/alocari", actionLabel: "Alocări pe campanii" },
  { id: "finance-due", title: "Urmărește ce trebuie emis și ce este restant", description: "Verifică lista facturilor de emis, termenele și încasările restante. Confirmă cu responsabilul comercial situațiile contestate înainte de a comunica solduri clienților.", evidence: "Fiecare document de emis sau sold restant are următorul pas și responsabil cunoscut.", href: "/admin/financiar/facturi-de-emis", actionLabel: "Facturi de emis" },
];

const field: WorkplaceStep[] = [
  { id: "field-agenda", title: "Identifică lucrarea atribuită", description: "Deschide operaționalul și verifică amplasamentul, tipul lucrării, perioada și termenul. Dacă nu vezi lucrarea corectă, cere alocarea responsabilului înainte de deplasare.", evidence: "Știi exact unde mergi, ce lucrare ai de făcut și până când.", href: "/admin/operational", actionLabel: "Lucrările mele" },
  { id: "field-brief", title: "Verifică instrucțiunile înainte de lucru", description: "Citește notele și materialele disponibile pentru lucrare. Confirmă cu responsabilul operațional orice instrucțiune incompletă sau contradictorie.", evidence: "Lucrarea și materialul corespund amplasamentului și campaniei indicate.", href: "/admin/operational", actionLabel: "Instrucțiunile lucrării" },
  { id: "field-evidence", title: "Pregătește dovada execuției", description: "Folosește fotografii lizibile ale lucrării și amplasamentului. Leagă dovada de lucrarea corectă; o fotografie a altei locații nu confirmă execuția.", evidence: "Fotografia permite identificarea locației și a materialului montat sau neutralizat.", href: "/admin/operational", actionLabel: "Dovezile lucrării" },
  { id: "field-status", title: "Actualizează starea reală a lucrării", description: "Marchează finalizarea numai după executare și adăugarea dovezii cerute. Dacă execuția este blocată, anunță responsabilul și păstrează situația deschisă.", evidence: "Starea din aplicație reflectă ce s-a întâmplat pe teren.", href: "/admin/operational", actionLabel: "Actualizează lucrarea" },
  { id: "field-handover", title: "Verifică predarea și următoarea lucrare", description: "Confirmă că dovada este vizibilă și verifică lucrările rămase. Problemele de amplasament, acces sau material se comunică responsabilului operațional.", evidence: "Responsabilul poate verifica lucrarea fără să caute separat fotografiile și explicațiile.", href: "/admin/operational", actionLabel: "Verifică predarea" },
];

const management: WorkplaceStep[] = [
  { id: "management-team", title: "Stabilește responsabilitățile și accesul", description: "Invită colegii în conturi individuale și verifică rolul, portofoliul și responsabilul fiecăruia. Parcurge ghidul împreună cu un coleg nou, folosind un dosar existent sau mediul de test.", evidence: "Fiecare coleg știe ce poate vedea, ce poate modifica și cui cere aprobarea.", href: "/admin/utilizatori", actionLabel: "Echipă și acces" },
  { id: "management-policy", title: "Validează regulile comerciale", description: "Stabilește moneda tarifelor, TVA-ul și limitele comerciale. Verifică aprobările cerute pentru oferte și blocări; un modul AI nu înlocuiește aprobarea comercială.", evidence: "Echipa poate pregăti o ofertă fără să ghicească moneda, taxele sau cine o aprobă.", href: "/admin/commercial-settings", actionLabel: "Reguli comerciale" },
  { id: "management-contract", title: "Reconciliază închirierile cu contractele", description: "Verifică locația, perioada, prețul și firma față de contractul semnat și actele adiționale. «Neverificat» nu înseamnă «corect». Corecțiile necesită documentul justificativ și revizuire.", evidence: "Diferențele au document-sursă, responsabil și o rezolvare urmărită.", href: "/admin/control-contractual", actionLabel: "Verificare contractuală" },
  { id: "management-delivery", title: "Verifică execuția și excepțiile", description: "Urmărește montajele, neutralizările, întârzierile și dovezile. Clarifică responsabilul și termenul fiecărei probleme care afectează clientul.", evidence: "O campanie confirmată poate fi urmărită până la execuția documentată.", href: "/admin/operational", actionLabel: "Execuție și lucrări" },
  { id: "management-finance", title: "Închide circuitul factură–încasare", description: "Verifică facturile de emis, soldurile și reconcilierea. Separă firmele și monedele și tratează explicit documentele negative sau plățile neatribuite.", evidence: "Sinteza firmei poate fi explicată prin contracte, facturi și încasări verificabile.", href: "/admin/financiar/incasari", actionLabel: "Facturi și încasări" },
];

const executive: WorkplaceStep[] = [
  { id: "executive-overview", title: "Citește sinteza și data actualizării", description: "Verifică situația comercială, operațională și financiară împreună cu momentul actualizării. O sursă indisponibilă nu este o valoare zero.", evidence: "Poți distinge datele actuale de cele neactualizate sau neverificate.", href: "/admin/dashboard", actionLabel: "Sinteza firmei" },
  { id: "executive-contract", title: "Verifică diferențele contractuale", description: "Urmărește diferențele dintre închirieri și documentele revizuite, fără a modifica datele. Cere responsabilului documentele sau explicațiile care lipsesc.", evidence: "Știi ce venituri și ocupări sunt susținute de documente și ce necesită verificare.", href: "/admin/control-contractual", actionLabel: "Verificare contractuală" },
  { id: "executive-campaign", title: "Urmărește campaniile și expirările", description: "Verifică locațiile, perioadele, documentele și finalurile apropiate în dosarul campaniei. Distinge oferta, blocarea temporară și închirierea confirmată.", evidence: "Poți urmări situația unui client fără a deduce starea doar din note.", href: "/admin/campanii", actionLabel: "Campanii" },
  { id: "executive-delivery", title: "Verifică executarea promisiunilor", description: "Urmărește lucrările întârziate și dovezile execuției. Cere responsabilului operațional rezolvarea excepțiilor.", evidence: "Ai o imagine a campaniilor afectate de întârzieri și a responsabililor lor.", href: "/admin/operational", actionLabel: "Operațional" },
  { id: "executive-finance", title: "Interpretează soldurile în context", description: "Verifică firma, moneda, perioada și documentele care necesită reconciliere înainte de a trage concluzii despre încasări sau restanțe.", evidence: "Poți explica principalele solduri și limitele informațiilor disponibile.", href: "/admin/financiar/incasari", actionLabel: "Situația facturilor" },
];

export function workplaceGuide(role: UserRole) {
  const tasks = role === "FIELD_OPERATOR" ? field : role === "FINANCE_OPERATOR" ? finance : role === "D_CEO" ? executive : ["COO", "SUPER_ADMIN"].includes(role) ? management : sales;
  return {
    version: WORKPLACE_GUIDE_VERSION,
    role,
    roleLabel: ROLE_LABELS[role],
    title: role === "FIELD_OPERATOR" ? "Primii pași în execuție" : role === "FINANCE_OPERATOR" ? "Primii pași în financiar" : role === "D_CEO" ? "Cum urmărești activitatea firmei" : ["COO", "SUPER_ADMIN"].includes(role) ? "Pune echipa și fluxurile în ordine" : "De la oportunitate la campanie executată",
    steps: [security, ...tasks],
  };
}
