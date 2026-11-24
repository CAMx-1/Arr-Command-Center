// Choose which edition a book uses (Chaptarr, legacy Readarr). For an
// audiobook the edition is the recording, so this is where its narrator is
// picked; the edition also drives release matching, naming and tags.
// Pure logic is lib/bookEditions.js.
import { h, mount, spinner, empty, toast, openModal, closeModal } from './ui.js';
import { roleAllows } from './roleUi.js';
import { FORMATS, bookCover, nameGradient } from './readarrLibrary.js';
import {
  editionsForBook, groupEditions, editionFacts, editionCover, editionLine, currentEdition, matchesEdition,
  selectEditionBody, autoSwitchBody, editionIsEbook, isCurrentEdition,
} from './bookEditions.js';

const GROUP_SHOWN = 2;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function coverEl(e, book) {
  const url = editionCover(e) || bookCover(book);
  const fallback = () => h('div', { class: 'edition-cover edition-cover-fallback', style: { backgroundImage: nameGradient(e && e.title) }, 'aria-hidden': 'true' }, editionIsEbook(e) ? FORMATS.ebook.icon : FORMATS.audiobook.icon);
  if (!url) return fallback();
  return h('img', { class: 'edition-cover', src: url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', onerror: function () { this.replaceWith(fallback()); } });
}

// The PUT body goes back as the app sent the book; it answers 202 with the id.
export async function openEditionPicker(arr, ctx, book, { onChanged } = {}) {
  const app = ctx.service.label;
  const body = h('div', { class: 'edition-picker' }, spinner());
  openModal({ title: `Edition · ${book.title || 'Book'}`, body, wide: true });
  let full; let listed;
  try {
    [full, listed] = await Promise.all([arr.get(`book/${book.id}`), arr.get(`edition?bookId=${book.id}`).catch(() => [])]);
  } catch (e) {
    return mount(body, empty('', 'Couldn’t load the editions', e.message));
  }
  if (!body.isConnected) return;
  const mediaType = book.mediaType || full.mediaType || '';
  const source = Array.isArray(listed) && listed.length ? listed : (Array.isArray(full.editions) ? full.editions : []);
  const editions = editionsForBook(source, { mediaType });
  const otherFormat = source.length - editions.length;
  const audio = mediaType !== 'ebook' && !editions.every(editionIsEbook);
  const canWrite = roleAllows('write');
  const hasAutoSwitch = 'anyEditionOk' in full;

  let term = '';
  const expanded = new Set();
  let confirming = null;

  const topSlot = h('div', {});
  const listSlot = h('div', {});
  const countEl = h('span', { class: 'dim' });

  const save = async (edition, btn) => {
    btn.disabled = true;
    try {
      await arr.put(`book/${full.id}`, selectEditionBody(full, edition));
      toast(`${book.title}: using ${editionLine(edition) || 'the chosen edition'}`, 'success', 3500);
      closeModal();
      if (onChanged) onChanged();
    } catch (e) {
      toast(e.message, 'error', 6000);
      btn.disabled = false;
    }
  };

  const renderTop = () => {
    const cur = currentEdition(editions);
    if (confirming) {
      const e = confirming;
      const useBtn = h('button', { class: 'btn primary', type: 'button', onclick: (ev) => save(e, ev.currentTarget) }, 'Use this edition');
      mount(topSlot, h('div', { class: 'card edition-confirm', role: 'alertdialog', 'aria-label': 'Use this edition?' },
        h('div', { class: 'edition-confirm-head' }, coverEl(e, book), h('div', {},
          h('div', { class: 'row-title' }, `Use ${editionLine(e) || e.title || 'this edition'}?`),
          h('p', { class: 'dim', style: { margin: '6px 0 0', fontSize: '13px', lineHeight: '1.5' } },
            `${app} links this book’s files to it${audio ? ' and sets their recording type from it' : ''}. The files stay in their folders. `,
            hasAutoSwitch ? `“Automatically switch edition” turns off, so ${app} keeps this one.` : '',
          ))),
        h('div', { class: 'edition-confirm-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => { confirming = null; renderTop(); } }, 'Cancel'), useBtn)));
      useBtn.focus();
      return;
    }
    const autoSwitch = hasAutoSwitch ? h('label', { class: 'edition-auto', title: `When on, ${app} moves the book to the edition that best matches the files it imports.` },
      h('input', {
        type: 'checkbox', role: 'switch', checked: full.anyEditionOk ? 'checked' : null, disabled: canWrite ? null : 'disabled',
        onchange: async (ev) => {
          const input = ev.currentTarget; const on = input.checked;
          input.disabled = true;
          try {
            await arr.put(`book/${full.id}`, autoSwitchBody(full, on));
            full.anyEditionOk = on;
            toast(on ? `${app} picks the edition from now on` : `${app} keeps the edition in use`, 'success', 2600);
          } catch (e) { input.checked = !on; toast(e.message, 'error', 6000); }
          input.disabled = !canWrite;
        },
      }), 'Automatically switch edition') : null;
    mount(topSlot, h('div', { class: 'card edition-current' },
      cur ? coverEl(cur, book) : null,
      h('div', { class: 'edition-current-main' },
        h('div', { class: 'section-title', style: { margin: 0 } }, 'In use'),
        h('div', { class: 'row-title', style: { marginTop: '4px' } }, cur ? (editionLine(cur) || cur.title) : 'No edition chosen yet'),
        cur && cur.title && cur.title !== book.title ? h('div', { class: 'row-sub' }, cur.title) : null,
        h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '6px', lineHeight: '1.5' } },
          audio ? `The edition is the recording: its narrator and length are what ${app} matches releases and writes tags with.`
            : `The edition sets the publisher, page count and identifiers ${app} matches releases with.`),
        autoSwitch,
      )));
  };

  const editionRow = (e) => {
    const facts = editionFacts(e).filter(([k]) => k !== 'Narrator' || !audio);
    const current = isCurrentEdition(e);
    return h('div', { class: `row edition-row${current ? ' is-current' : ''}` },
      coverEl(e, book),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '14px' } }, e.title || book.title || 'Edition'),
        h('div', { class: 'meta-line', style: { marginTop: '4px' } },
          current ? h('span', { class: 'pill info' }, 'In use') : null,
          Number(e.bookFileCount) > 0 ? h('span', { class: 'pill ok' }, plural(Number(e.bookFileCount), 'file')) : null,
          ...facts.map(([k, v]) => h('span', { class: /ASIN|ISBN/.test(k) ? 'mono dim' : '', title: k }, k === 'Pages' ? `${v} pages` : v)),
          e.ratings && Number(e.ratings.votes) > 0 ? h('span', { class: 'dim', title: `${Number(e.ratings.votes).toLocaleString()} ratings` }, `★ ${Number(e.ratings.value || 0).toFixed(1)}`) : null,
        )),
      current ? null : h('div', { class: 'row-actions' },
        h('button', {
          class: 'btn sm', type: 'button', 'data-needs': 'write', title: 'Make this the edition the book uses',
          onclick: () => { confirming = e; renderTop(); topSlot.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); },
        }, 'Use')));
  };

  const renderList = () => {
    const shown = editions.filter((e) => matchesEdition(e, term));
    mount(countEl, shown.length === editions.length ? plural(editions.length, 'edition') : `${shown.length} of ${plural(editions.length, 'edition')}`);
    if (!editions.length) {
      return mount(listSlot, empty('📚', `No ${mediaType && FORMATS[mediaType] ? FORMATS[mediaType].one.toLowerCase() : ''} editions listed`.replace(/\s+/g, ' '),
        `${app} has no edition of this book${otherFormat ? ` in this format (${plural(otherFormat, 'edition')} in the other one)` : ''}. A refresh of the author can bring more.`));
    }
    if (!shown.length) return mount(listSlot, empty('', 'No edition matches', 'Try a narrator, publisher, year or ASIN.'));
    const groups = groupEditions(shown, audio ? 'audiobook' : 'ebook');
    mount(listSlot, ...groups.map((g) => {
      const open = term || expanded.has(g.key) || g.editions.length <= GROUP_SHOWN + 1;
      const visible = open ? g.editions : g.editions.slice(0, GROUP_SHOWN);
      return h('div', { class: 'edition-group' },
        audio ? h('div', { class: 'edition-group-head' },
          h('span', { class: 'row-title', style: { fontSize: '14px' } }, g.label || 'Narrator not listed'),
          h('span', { class: 'dim' }, plural(g.editions.length, 'edition'))) : null,
        h('div', { class: 'list' }, ...visible.map(editionRow)),
        open ? null : h('button', { class: 'btn sm', type: 'button', onclick: () => { expanded.add(g.key); renderList(); } }, `Show ${g.editions.length - visible.length} more`));
    }));
  };

  const search = h('input', { class: 'input', type: 'search', placeholder: audio ? 'Filter by narrator, publisher, year, ASIN…' : 'Filter by publisher, year, ISBN…', 'aria-label': 'Filter editions', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  search.addEventListener('input', () => { term = search.value; renderList(); });
  mount(body,
    topSlot,
    editions.length > 4 ? h('div', { class: 'edition-tools' }, search, countEl) : h('div', { class: 'edition-tools' }, countEl),
    listSlot);
  renderTop();
  renderList();
}
