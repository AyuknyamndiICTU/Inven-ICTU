export type TemplateId =
  | 'otp'
  | 'low_stock'
  | 'out_of_stock'
  | 'test'
  | 'credential_approved'
  | 'credential_rejected'
  | 'credential_pending'
  | 'overdue'
  | 'device_revoked'
  | 'card_linked'
  | 'sync_conflict';

export type Locale = 'en' | 'fr';
export type TemplateData = Record<string, string | number>;

export interface Rendered {
  subject: string;
  text: string;
  html: string;
  /** Short form for SMS / push (≤ 160 characters where possible). */
  short: string;
}

const T: Record<TemplateId, Record<Locale, (d: TemplateData) => { subject: string; body: string; short: string }>> = {
  otp: {
    en: (d) => ({
      subject: 'Your LabPass code',
      body: `Your LabPass verification code is ${d.code}. It expires in 10 minutes. If you did not request it, ignore this message.`,
      short: `LabPass code: ${d.code} (10 min)`,
    }),
    fr: (d) => ({
      subject: 'Votre code LabPass',
      body: `Votre code de vérification LabPass est ${d.code}. Il expire dans 10 minutes. Si vous ne l’avez pas demandé, ignorez ce message.`,
      short: `Code LabPass : ${d.code} (10 min)`,
    }),
  },
  low_stock: {
    en: (d) => ({
      subject: `Low stock: ${d.item}`,
      body: `${d.item} is running low at the Cisco Lab: ${d.available} available (alert level ${d.threshold}).`,
      short: `LabPass: ${d.item} low — ${d.available} left (alert ${d.threshold})`,
    }),
    fr: (d) => ({
      subject: `Stock faible : ${d.item}`,
      body: `${d.item} est bientôt épuisé au laboratoire Cisco : ${d.available} disponible(s) (seuil ${d.threshold}).`,
      short: `LabPass : ${d.item} faible — ${d.available} restant(s) (seuil ${d.threshold})`,
    }),
  },
  out_of_stock: {
    en: (d) => ({
      subject: `Out of stock: ${d.item}`,
      body: `${d.item} is now out of stock at the Cisco Lab.`,
      short: `LabPass: ${d.item} OUT OF STOCK`,
    }),
    fr: (d) => ({
      subject: `Rupture : ${d.item}`,
      body: `${d.item} est en rupture de stock au laboratoire Cisco.`,
      short: `LabPass : ${d.item} EN RUPTURE`,
    }),
  },
  test: {
    en: () => ({
      subject: 'LabPass test notification',
      body: 'This is a test notification from LabPass. Your channel works.',
      short: 'LabPass test: your channel works.',
    }),
    fr: () => ({
      subject: 'Notification de test LabPass',
      body: 'Ceci est une notification de test LabPass. Votre canal fonctionne.',
      short: 'Test LabPass : votre canal fonctionne.',
    }),
  },
  credential_approved: {
    en: () => ({
      subject: 'Your LabPass is ready',
      body: 'Your LabPass credential has been approved. Open the app to use it at the Cisco Lab.',
      short: 'Your LabPass is ready.',
    }),
    fr: () => ({
      subject: 'Votre LabPass est prêt',
      body: 'Votre identifiant LabPass a été approuvé. Ouvrez l’application pour l’utiliser au laboratoire Cisco.',
      short: 'Votre LabPass est prêt.',
    }),
  },
  credential_rejected: {
    en: (d) => ({
      subject: 'LabPass request not approved',
      body: `Your LabPass request was not approved: ${d.reason}. Please see a lab assistant.`,
      short: 'LabPass request not approved. See a lab assistant.',
    }),
    fr: (d) => ({
      subject: 'Demande LabPass refusée',
      body: `Votre demande LabPass n’a pas été approuvée : ${d.reason}. Veuillez voir un assistant.`,
      short: 'Demande LabPass refusée. Voyez un assistant.',
    }),
  },
  credential_pending: {
    en: (d) => ({
      subject: 'New LabPass request to review',
      body: `A LabPass request for ${d.matricule} needs review in the admin console.`,
      short: `LabPass: request ${d.matricule} needs review`,
    }),
    fr: (d) => ({
      subject: 'Nouvelle demande LabPass à examiner',
      body: `Une demande LabPass pour ${d.matricule} doit être examinée dans la console.`,
      short: `LabPass : demande ${d.matricule} à examiner`,
    }),
  },
  overdue: {
    en: (d) => ({
      subject: 'LabPass: equipment overdue',
      body: `Please return ${d.items} to the Cisco Lab. It was due ${d.due}.`,
      short: `LabPass: please return ${d.items} (due ${d.due})`,
    }),
    fr: (d) => ({
      subject: 'LabPass : matériel en retard',
      body: `Veuillez rendre ${d.items} au laboratoire Cisco. Échéance : ${d.due}.`,
      short: `LabPass : rendez ${d.items} (échéance ${d.due})`,
    }),
  },
  device_revoked: {
    en: () => ({
      subject: 'Your LabPass device was removed',
      body: 'Your LabPass credential on a previous device has been revoked. If this was not you, contact the lab.',
      short: 'LabPass: previous device revoked.',
    }),
    fr: () => ({
      subject: 'Appareil LabPass retiré',
      body: 'Votre identifiant LabPass sur un ancien appareil a été révoqué. Si ce n’était pas vous, contactez le laboratoire.',
      short: 'LabPass : ancien appareil révoqué.',
    }),
  },
  card_linked: {
    en: () => ({
      subject: 'Card linked to LabPass',
      body: 'Your ICTU card is now linked to LabPass.',
      short: 'LabPass: card linked.',
    }),
    fr: () => ({
      subject: 'Carte liée à LabPass',
      body: 'Votre carte ICTU est maintenant liée à LabPass.',
      short: 'LabPass : carte liée.',
    }),
  },
  sync_conflict: {
    en: (d) => ({
      subject: 'Offline sync needs review',
      body: `${d.count} offline transaction(s) from kiosk ${d.kiosk} need review in the admin console.`,
      short: `LabPass: ${d.count} offline conflict(s) to review`,
    }),
    fr: (d) => ({
      subject: 'Synchronisation hors ligne à vérifier',
      body: `${d.count} transaction(s) hors ligne de la borne ${d.kiosk} doivent être vérifiées.`,
      short: `LabPass : ${d.count} conflit(s) hors ligne`,
    }),
  },
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function render(template: TemplateId, locale: Locale, data: TemplateData = {}): Rendered {
  const t = (T[template][locale] ?? T[template].en)(data);
  const html = `<!doctype html><html><body style="font-family:Inter,Segoe UI,sans-serif;background:#FAFAF9;padding:24px;color:#171717">
<div style="max-width:520px;margin:auto;background:#fff;border:1px solid #E7E6E3;border-radius:24px;padding:28px">
<p style="font-size:12px;color:#6B6F76;margin:0 0 12px">ICTU · Cisco Lab · LabPass</p>
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(t.subject)}</h1>
<p style="font-size:15px;line-height:1.5;margin:0">${escapeHtml(t.body)}</p></div></body></html>`;
  return { subject: t.subject, text: t.body, html, short: t.short };
}
