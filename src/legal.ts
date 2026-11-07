/**
 * Footer and legal links, built from the constants in src/config.ts. Used at build time by vite.config.ts (the static
 * footer in every HTML page) and at run time by the Credits screen (phones have no footer during play). Pure strings.
 */
import { CONTACT_EMAIL, SITE_DOMAIN, SOURCE_URL, TITLE } from './config';

export const COPYRIGHT_YEAR = 2026;

/** "The Nightgrave Authors", or the site domain once it is set. */
export const owner = (): string => SITE_DOMAIN.trim() || `The ${TITLE} Authors`;

export const copyrightLine = (): string => `(c) ${COPYRIGHT_YEAR} ${owner()}. Code: MIT. Art and audio: all rights reserved.`;

/** A plausible mailbox (no spaces, one @, a dot in the domain): anything else hides the Contact link. */
export const contactEmail = (): string => {
  const e = CONTACT_EMAIL.trim();
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(e) ? e : '';
};

export interface LegalLink {
  label: string;
  href: string;
  external: boolean;
}

/** Footer links: Privacy, Rules, Credits, License (pages next to index.html), Source, Contact (only when set). */
export function legalLinks(): LegalLink[] {
  const links: LegalLink[] = [
    { label: 'Privacy', href: './privacy.html', external: false },
    { label: 'Rules', href: './rules.html', external: false },
    { label: 'Credits', href: './credits.html', external: false },
    { label: 'License', href: './license.html', external: false },
  ];
  if (/^https:\/\//.test(SOURCE_URL)) links.push({ label: 'Source', href: SOURCE_URL, external: true });
  const mail = contactEmail();
  if (mail) links.push({ label: 'Contact', href: `mailto:${mail}`, external: true });
  return links;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Static footer markup (escaped; written into the HTML at build time, no script involved). */
export function footerHtml(): string {
  const links = legalLinks()
    // a new tab for everything but mail: a footer click never ends a run in progress
    .map((l) => `<a href="${esc(l.href)}"${l.href.startsWith('mailto:') ? '' : ' target="_blank" rel="noopener noreferrer"'}>${esc(l.label)}</a>`)
    .join(' ');
  return `<span class="ft-copy">${esc(copyrightLine())}</span> <span class="ft-links">${links}</span>`;
}

/**
 * The contact sentence on the privacy page: the mailbox when set; otherwise the PRIVATE route of SECURITY.md (GitHub's
 * private report form on the repository's Security tab), never a public issue with personal details.
 */
export function contactHtml(): string {
  const mail = contactEmail();
  if (mail) return `write to <a href="mailto:${esc(mail)}">${esc(mail)}</a>`;
  if (!/^https:\/\//.test(SOURCE_URL)) return 'contact the site operator';
  return `send a private request through the "Report a vulnerability" form on the Security tab of the <a href="${esc(SOURCE_URL)}/security" target="_blank" rel="noopener noreferrer">source repository</a> (it is seen only by the maintainers; if the form is missing, open an issue that only asks for a private contact, without any personal details)`;
}
