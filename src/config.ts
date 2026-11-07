/** The game title lives here and only here. Rename the game by changing this constant. */
export const TITLE = 'Nightgrave';

/** One-line description for the page and link previews (index.html is filled from these at build time). */
export const DESCRIPTION = 'A dark-fantasy dodge-and-parry survival game. One hit and the night wins. Free in the browser.';

/**
 * Public site address, e.g. 'https://nightgrave.example' (no trailing slash). Empty: og:url and og:image are left out
 * (link previews need absolute URLs). The VITE_SITE_URL environment variable overrides it at build time.
 */
export const SITE_URL = 'https://nightgrave.com';

/** Domain shown in the footer copyright, e.g. 'nightgrave.example'. Empty: "The <TITLE> Authors". */
export const SITE_DOMAIN = 'nightgrave.com';

/** Source code link in the footer and on the Credits page. */
export const SOURCE_URL = 'https://github.com/emiontheautismspectrum/nightgrave';

/**
 * Contact address for privacy / deletion requests (footer "Contact" link). Empty: the link is hidden.
 * Never put a personal address here; use a project mailbox.
 */
export const CONTACT_EMAIL = '';

/** Internal resolution (integer-scaled, nearest-neighbour). */
export const VIEW_WIDTH = 480;
export const VIEW_HEIGHT = 270;
