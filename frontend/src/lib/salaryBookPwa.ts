const THEME = '#047857';
const TITLE = 'Salary Book';

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function upsertLink(rel: string, href: string, extra?: Record<string, string>) {
  let el = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
  if (extra) {
    Object.entries(extra).forEach(([k, v]) => el!.setAttribute(k, v));
  }
}

export function isStandaloneApp() {
  const mq = window.matchMedia('(display-mode: standalone)').matches;
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mq || ios;
}

export function applySalaryBookPwa() {
  document.documentElement.classList.add('salary-book');
  document.title = TITLE;
  upsertMeta('name', 'theme-color', THEME);
  upsertMeta('name', 'apple-mobile-web-app-capable', 'yes');
  upsertMeta('name', 'mobile-web-app-capable', 'yes');
  upsertMeta('name', 'apple-mobile-web-app-status-bar-style', 'black-translucent');
  upsertMeta('name', 'apple-mobile-web-app-title', TITLE);
  upsertMeta('name', 'application-name', TITLE);
  upsertLink('manifest', '/salary-book.webmanifest');
  upsertLink('apple-touch-icon', '/icons/salary-book-180.png', { sizes: '180x180' });
  upsertLink('icon', '/favicon-salary-book.svg', { type: 'image/svg+xml' });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw-salary-book.js').catch(() => undefined);
  }
}

export function displayName(user: {
  first_name?: string;
  last_name?: string;
  username?: string;
} | null) {
  const name = `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
  return name || user?.username || 'User';
}

export function initials(user: {
  first_name?: string;
  last_name?: string;
  username?: string;
} | null) {
  const first = (user?.first_name || '').trim();
  const last = (user?.last_name || '').trim();
  if (first || last) return `${first.slice(0, 1)}${last.slice(0, 1)}`.toUpperCase() || 'U';
  return (user?.username || 'U').slice(0, 2).toUpperCase();
}
