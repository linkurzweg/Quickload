<script lang="ts">
  import { version } from '../package.json';
  import { onMount, tick } from 'svelte';
  import { manageTooltips } from './lib/tooltips';
  import {
    Search,
    Settings as SettingsIcon,
    Maximize,
    Minimize,
    Plus,
    RefreshCw,
    Play,
    Heart,
    ChevronRight,
    ArrowLeft,
    X,
    Check,
    Gamepad2,
    FolderOpen,
    Monitor,
    Sparkles,
    Library as LibraryIcon,
    CircleAlert,
    ImagePlus,
    Power,
    Download,
  } from '@lucide/svelte';
  import GameCard from './components/GameCard.svelte';
  import ProviderIcon from './components/ProviderIcon.svelte';
  import Glyph from './components/Glyph.svelte';
  import { formatDuration } from './lib/duration';
  import { SettingsWriter, resetPreferences, type SaveStatus } from './lib/settings';
  import { createSoundFeedback } from './lib/sound';
  import Artwork from './components/Artwork.svelte';
  import ArtworkFraming from './components/ArtworkFraming.svelte';
  import { importArtwork, refreshMissingArtwork, warmDetails } from './lib/artwork';
  import { api, native } from './lib/api';
  import {
    defaults,
    type ArtworkPositions,
    type Game,
    type LaunchReport,
    type Library,
    type Settings,
    type Store,
  } from './lib/types';
  import {
    startController,
    moveFocus,
    trackFocusVisibility,
    type GlyphFamily,
  } from './lib/controller';
  import { selectGames, groupGames, groupCards } from './lib/library';
  import { trackScrollbars } from './lib/scrollbars';
  import SelectControl from './components/SelectControl.svelte';
  import { resolveLocale, translate, storeName } from './lib/i18n';
  import { fullscreenKeys, isFullscreenShortcut } from './lib/platform';
  import { closeActiveSelect } from './lib/controller';

  type Page = 'home' | 'library' | 'favorites' | 'settings';
  let library = $state<Library>({ games: [], settings: { ...defaults }, lastScan: null });
  let page = $state<Page>('home');
  let query = $state(''),
    source = $state<Store | 'all'>('all'),
    sort = $state<'recent' | 'title'>('recent');
  let loading = $state(true),
    scanning = $state(false),
    launching = $state(false),
    saving = $state(false),
    fullscreen = $state(false);
  let loadError = $state(''),
    notice = $state(''),
    warnings = $state<string[]>([]),
    scanMs = $state<number | null>(null);
  let detailId = $state<string | null>(null),
    featuredId = $state<string | null>(null);
  let addOpen = $state(false),
    manualTitle = $state(''),
    manualPath = $state('');
  let controllerFamily = $state<GlyphFamily | null>(null),
    controllerName = $state('');
  let draft = $state<Settings>({ ...defaults });
  let preferenceStatus = $state<SaveStatus>('saved');
  let preferenceError = $state('');
  let loginAvailable = $state(false);
  let providerIcons = $state<Partial<Record<Store, string>>>({});
  let providerIconsBusy = $state(true);
  let updatesAvailable = $state(false);
  let updateVersion = $state<string | null>(null);
  let updateStatus = $state<'idle' | 'checking' | 'current' | 'downloading' | 'ready' | 'error'>(
    'idle',
  );
  let installOnClose = false;
  const updateBusy = $derived(updateStatus === 'checking' || updateStatus === 'downloading');
  let settingsWriter: SettingsWriter | undefined;
  let feedback: ReturnType<typeof createSoundFeedback> | undefined;
  let systemLanguages = $state([...navigator.languages]);
  const locale = $derived(resolveLocale(draft.language, systemLanguages));
  const fullscreenHint = fullscreenKeys(navigator.platform);
  $effect(() => {
    document.documentElement.lang = locale;
    document.title = `Quickload · ${translate(locale, 'Your next adventure')}`;
  });
  /** Translate English `message` using the current UI locale and optional named `parameters`. */
  function t(message: string, parameters: Record<string, string | number> = {}) {
    return translate(locale, message, parameters);
  }
  let resultPage = $state(0);
  let artworkRevision = $state(0);
  let searchInput = $state<HTMLInputElement>();
  let keyboardSession = $state<{ target: HTMLInputElement | HTMLTextAreaElement }>();
  const keyboardTarget = $derived(keyboardSession?.target);
  let ScreenKeyboard = $state<typeof import('./components/ScreenKeyboard.svelte').default>();
  let keyboardPanel = $state<{ controllerShortcut(action: string): void }>();
  let fuzzySearch = $state<{ query: string; titles: ReadonlySet<string> }>();
  let toastTimer: ReturnType<typeof setTimeout>;
  let returnFocus: HTMLElement | null = null;
  let lastLaunch = $state<{ id: string; title: string; report: LaunchReport }>();
  let editingArtwork = $state(false);
  const stores: Store[] = [
    'steam',
    'epic',
    'gog',
    'xbox',
    'ubisoft',
    'battlenet',
    'rockstar',
    'manual',
  ];
  let quitOpen = $state(false);
  const family = $derived(
    draft.controller === 'auto' ? (controllerFamily ?? 'xbox') : draft.controller,
  );
  const usingController = $derived(controllerFamily !== null || draft.controller !== 'auto');
  const groups = $derived(groupGames(library.games));
  const allCards = $derived(groupCards(groups, draft.preferredInstallations, 'all'));
  const scopedCards = $derived(
    source === 'all' ? allCards : groupCards(groups, draft.preferredInstallations, source),
  );
  const keyboardTitles = $derived(
    keyboardTarget && keyboardTarget === searchInput
      ? scopedCards
          .filter((game) => page !== 'favorites' || game.favorite)
          .map((game) => game.title)
      : [],
  );
  const filtered = $derived.by(() => {
    const exact = selectGames(scopedCards, query, 'all', page === 'favorites', sort);
    if (exact.length || fuzzySearch?.query !== query) return exact;
    const titles = fuzzySearch.titles;
    return selectGames(
      scopedCards.filter((game) => titles.has(game.title)),
      '',
      'all',
      page === 'favorites',
      sort,
    );
  });
  const shelf = $derived(page === 'home');
  const pageSize = $derived(shelf ? 20 : 60);
  const visibleGames = $derived(filtered.slice(resultPage * pageSize, (resultPage + 1) * pageSize));
  const featured = $derived(
    shelf ? (visibleGames.find((game) => game.id === featuredId) ?? visibleGames[0]) : undefined,
  );

  /** Apply the selected store and start the Home preview at the first matching game. */
  function selectStore(store: Store | 'all') {
    source = store;
    featuredId = null;
  }
  const detail = $derived(library.games.find((g) => g.id === detailId));
  $effect(() => {
    void artworkRevision;
    if (draft.artwork) return warmDetails(library.games);
  });
  const detailGroup = $derived(
    detailId
      ? groups.find((group) => group.installations.some((game) => game.id === detailId))
      : undefined,
  );
  const installed = $derived(allCards.filter((g) => g.installed).length);
  $effect(() => {
    if (loading || scanning || !updatesAvailable || !draft.automaticUpdates) return;
    const timer = setTimeout(checkAutomatically, 60_000);
    return () => clearTimeout(timer);
  });
  const modal = $derived(Boolean(detailId || addOpen || keyboardTarget || quitOpen));
  const reducedMotion = $derived(draft.reducedMotion);
  $effect(() => {
    if (!modal) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  });
  $effect(() => {
    void page;
    void query;
    void source;
    void sort;
    resultPage = 0;
  });
  /** Move by `delta` pages and focus the first visible game after Svelte updates the DOM. */

  async function changeResultPage(delta: number) {
    const nextPage = resultPage + delta;
    if (nextPage < 0 || nextPage * pageSize >= filtered.length) return;
    resultPage = nextPage;
    await tick();
    const cards = document.querySelectorAll<HTMLElement>(
      '.game-grid [data-game], .game-shelf [data-game]',
    );
    cards[shelf && delta < 0 ? cards.length - 1 : 0]?.focus({ preventScroll: true });
  }

  /** Display `message` in the live status region, replacing and resetting the previous notification timer. */

  function toast(message: string) {
    notice = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (notice = ''), 6500);
  }
  /** Convert the caught value `e` into a readable notification without discarding the current library. */

  function error(e: unknown) {
    toast(t(e instanceof Error ? e.message : String(e)));
  }
  /** Load the cached library and editable settings; optionally scan in the background and expose load errors. */

  async function load() {
    loading = true;
    loadError = '';
    try {
      library = await api.load();
      draft = { ...defaults, ...structuredClone($state.snapshot(library.settings)) };
      settingsWriter = new SettingsWriter(
        $state.snapshot(draft),
        (next) => api.settings(next),
        (status, cause) => {
          preferenceStatus = status;
          preferenceError = cause ? String(cause) : '';
          if (status === 'error') toast(t('Changes could not be saved.'));
        },
      );
      if (native) fullscreen = (await api.fullscreenState()) === true;
      loginAvailable = await api.loginStartupSupported();
      void api
        .updatesSupported()
        .then((supported) => (updatesAvailable = supported))
        .catch(() => {});
      if (native && draft.startupScan) void scan();
    } catch (e) {
      loadError = String(e);
    } finally {
      loading = false;
    }
  }
  /** Check at most daily across launches without blocking startup or local discovery. */
  function checkAutomatically() {
    if (updateStatus !== 'idle') return;
    const key = 'quickload-last-update-check';
    const now = Date.now();
    try {
      const last = Number(localStorage.getItem(key));
      if (last <= now && now - last < 86_400_000) return;
      localStorage.setItem(key, String(now));
    } catch {
      // When storage is blocked, the current session still performs at most one automatic check.
    }
    void checkForUpdate(true);
  }

  /** Refresh the available version and optionally stage it while Quickload stays usable. */
  async function checkForUpdate(automatic = false) {
    if (updateBusy || updateStatus === 'ready') return;
    updateStatus = 'checking';
    updateVersion = null;
    try {
      updateVersion = await api.checkUpdate();
      updateStatus = updateVersion ? 'idle' : 'current';
      if (updateVersion && automatic && draft.automaticUpdates) await downloadUpdate();
    } catch {
      updateStatus = 'error';
    }
  }

  /** Download and verify the available update, leaving installation until close. */
  async function downloadUpdate() {
    if (!updateVersion || updateBusy || updateStatus === 'ready') return;
    updateStatus = 'downloading';
    try {
      await api.stageUpdate();
      updateStatus = 'ready';
    } catch {
      updateStatus = 'error';
    }
  }

  /** Request a guarded close that installs the staged update even with automation disabled. */
  async function installAndQuit() {
    installOnClose = true;
    try {
      await api.quit();
    } catch (cause) {
      installOnClose = false;
      error(cause);
    }
  }

  /** Save preferences before applying a staged update or allowing the window to close. */
  async function prepareClose(): Promise<boolean> {
    const install = installOnClose || draft.automaticUpdates;
    installOnClose = false;
    if (settingsWriter && !(await settingsWriter.flush())) return false;
    if (install && updateStatus === 'ready') {
      try {
        await api.installUpdate();
      } catch {
        updateStatus = 'error';
        toast(t('The update could not be installed.'));
        return false;
      }
    }
    return true;
  }
  /** Run one library scan at a time, publish its results and report provider warnings and elapsed time. */

  async function scan() {
    if (scanning) return;
    scanning = true;
    try {
      const result = await api.scan();
      library = result.library;
      refreshMissingArtwork();
      artworkRevision++;
      warnings = result.warnings;
      scanMs = result.elapsedMs;
      toast(
        t('{count} installed games · Scan in {duration}', {
          count: library.games.filter((g) => g.installed).length,
          duration: formatDuration(result.elapsedMs, locale),
        }) + (warnings.length ? t(' · {count} notes', { count: warnings.length }) : ''),
      );
    } catch (e) {
      error(e);
    } finally {
      scanning = false;
    }
  }
  /** Persist the inverse favorite flag for `game`; keep the current library if persistence fails. */

  async function favorite(game: Game) {
    try {
      library = await api.favorite(game.id, !game.favorite);
    } catch (e) {
      error(e);
    }
  }
  /** Request a launch of the known `game` ID, prevent concurrent requests and show bridge errors. */

  async function launch(game: Game) {
    if (launching || !game.installed) return;
    launching = true;
    lastLaunch = undefined;
    try {
      const { library: next, report } = await api.launch(game.id);
      library = next;
      lastLaunch = { id: game.id, title: game.title, report };
      toast(launchMessage(report));
    } catch (e) {
      lastLaunch = {
        id: game.id,
        title: game.title,
        report: { status: 'failed', route: 'IPC', error: String(e) },
      };
      error(e);
    } finally {
      launching = false;
    }
  }

  /** Describe `report` without presenting an unconfirmed handoff as a running game. */
  function launchMessage(report: LaunchReport): string {
    if (report.status === 'running') return t('Game process detected');
    if (report.status === 'failed') return t('Game launch failed');
    return t('Launch handed over · Game process not confirmed');
  }

  /** Copy the latest local diagnostic, showing selectable text if clipboard access is unavailable. */
  async function copyLaunch(): Promise<void> {
    if (!lastLaunch) return;
    const text = JSON.stringify($state.snapshot(lastLaunch), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast(t('Launch diagnostic copied'));
    } catch {
      const field = document.querySelector<HTMLTextAreaElement>('.launch-diagnostic textarea');
      field?.focus();
      field?.select();
    }
  }

  /** Persist the selected installation `id` for the current title group. */
  async function preferInstallation(id: string): Promise<void> {
    const group = detailGroup;
    if (!group?.installations.some((game) => game.id === id) || saving) return;
    saving = true;
    try {
      const settings = $state.snapshot(draft);
      updatePreferences({
        preferredInstallations: { ...settings.preferredInstallations, [group.key]: id },
      });
      if (!(await settingsWriter?.flush())) return;
      if (detailGroup?.key === group.key) {
        editingArtwork = false;
        detailId = id;
        featuredId = id;
      }
    } catch (cause) {
      error(cause);
    } finally {
      saving = false;
    }
  }

  /** Save independent cover and hero `positions` for the current installation. */
  async function saveArtworkPositions(positions: ArtworkPositions): Promise<void> {
    if (!detail || saving) return;
    saving = true;
    try {
      const settings = $state.snapshot(draft);
      updatePreferences({
        artworkPositions: { ...settings.artworkPositions, [detail.id]: positions },
      });
      if (!(await settingsWriter?.flush())) return;
      editingArtwork = false;
      await tick();
      document.querySelector<HTMLElement>('.artwork-frame-trigger')?.focus();
    } catch (cause) {
      error(cause);
    } finally {
      saving = false;
    }
  }
  /** Toggle borderless desktop fullscreen and retain the previous UI state if the native request fails. */

  async function toggleFullscreen() {
    try {
      fullscreen = await api.fullscreen(!fullscreen);
      feedback?.play(fullscreen ? 'expand' : 'collapse');
      await tick();
      if (!draft.reducedMotion && !matchMedia('(prefers-reduced-motion: reduce)').matches)
        document.querySelector('main')?.animate(
          [
            { opacity: 0.8, transform: 'scale(0.99)' },
            { opacity: 1, transform: 'scale(1)' },
          ],
          { duration: 180, easing: 'ease-out' },
        );
    } catch (e) {
      error(e);
    }
  }
  /** Show `next`, reset search/provider filters and flush pending text preference edits. */

  function navigate(next: Page) {
    const changed = page !== next;
    page = next;
    query = '';
    source = 'all';
    void settingsWriter?.flush();
    if (changed)
      void tick().then(() => {
        const main = document.querySelector('main');
        if (!main || draft.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches)
          return;
        for (const animation of main.getAnimations()) animation.cancel();
        main.animate(
          [
            { opacity: 0.65, transform: 'translateY(5px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: 200, easing: 'ease-out' },
        );
      });
  }
  /** Open details for `game` and transfer focus into the dialog after its DOM has been rendered. */

  async function openDetail(game: Game) {
    returnFocus = document.activeElement as HTMLElement;
    detailId = game.id;
    editingArtwork = false;
    await tick();
    const play = document.querySelector<HTMLElement>('.detail-play:not(:disabled)');
    (play ?? document.querySelector<HTMLElement>('.detail-modal .modal-close'))?.focus();
  }
  /** Open an empty manual-game form, remembering the triggering control for focus restoration. */

  async function openAdd() {
    returnFocus = document.activeElement as HTMLElement;
    manualTitle = '';
    manualPath = '';
    addOpen = true;
    await tick();
    document.querySelector<HTMLElement>('[data-modal] input')?.focus();
  }
  /** Close either dialog and restore focus to its triggering control after the DOM update. */

  function closeModal() {
    const previous = detailId;
    detailId = null;
    addOpen = false;
    quitOpen = false;
    void tick().then(() => {
      const fallback = previous
        ? document.querySelector<HTMLElement>(`[data-game="${CSS.escape(previous)}"]`)
        : null;
      (returnFocus?.isConnected ? returnFocus : (fallback ?? searchInput))?.focus();
    });
  }
  /** Open an exit confirmation, initially focusing Cancel for safe controller navigation. */
  async function openQuit() {
    returnFocus = document.activeElement as HTMLElement;
    quitOpen = true;
    await tick();
    document.querySelector<HTMLElement>('.quit-cancel')?.focus();
  }
  /** Flush preferences before native closure; retain the window and report save or close errors. */
  async function quit() {
    if (settingsWriter && !(await settingsWriter.flush())) {
      closeModal();
      page = 'settings';
      return;
    }
    try {
      await api.quit();
    } catch (cause) {
      error(cause);
    }
  }
  /** Choose an executable through the native file dialog; explain the limitation in browser preview. */

  async function pickFile() {
    if (!native) {
      toast(t('File selection is available in the desktop app.'));
      return;
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const path = await open({ multiple: false, directory: false, title: t('Choose game') });
      if (typeof path === 'string') manualPath = path;
    } catch (e) {
      error(e);
    }
  }
  /** Choose a local raster cover for `game`, cache a copy and refresh visible artwork. */
  async function chooseCover(game: Game) {
    if (!native) {
      toast(t('Custom covers are available in the desktop app.'));
      return;
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const path = await open({
        multiple: false,
        title: t('Choose cover'),
        filters: [{ name: t('Game cover'), extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      });
      if (typeof path === 'string') {
        await importArtwork(game, path);
        artworkRevision++;
        toast(t('Cover saved.'));
      }
    } catch (e) {
      error(e);
    }
  }

  /** Choose or remove a local icon for `store`. Publish the new image only after native persistence succeeds. */
  async function changeProviderIcon(store: Store, reset = false) {
    if (providerIconsBusy) return;
    providerIconsBusy = true;
    try {
      let path: string | undefined;
      if (!reset) {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
          multiple: false,
          title: t('Choose provider icon'),
          filters: [{ name: t('SVG image'), extensions: ['svg'] }],
        });
        if (typeof selected !== 'string') return;
        path = selected;
      }
      providerIcons[store] = (await api.setProviderIcon(store, path)) ?? undefined;
      toast(t(reset ? 'Provider icon removed.' : 'Provider icon saved.'));
    } catch (cause) {
      error(cause);
    } finally {
      providerIconsBusy = false;
    }
  }

  /** Choose a local SVG folder and merge the icons saved by the native import. */
  async function importProviderIcons() {
    if (providerIconsBusy) return;
    providerIconsBusy = true;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const path = await open({ directory: true, multiple: false, title: t('Import SVG folder') });
      if (typeof path !== 'string') return;
      const { icons, failed } = await api.importProviderIcons(path);
      Object.assign(providerIcons, icons);
      const count = Object.keys(icons).length;
      if (failed) error(t('Some provider icons could not be saved.'));
      else if (count === 0) toast(t('No matching SVGs for providers without icons.'));
      else toast(t('Provider icons imported: {count}', { count }));
    } catch (cause) {
      error(cause);
    } finally {
      providerIconsBusy = false;
    }
  }

  /** Handle form `event`, prevent navigation and persist the manual title/path once per submission. */
  async function addGame(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;
    saving = true;
    try {
      library = await api.add(manualTitle, manualPath);
      closeModal();
      toast(t('Game added to your library.'));
    } catch (e) {
      error(e);
    } finally {
      saving = false;
    }
  }
  /** Remove only the library entry for `game`; the native bridge enforces manual-only removal. */

  async function removeManual(game: Game) {
    try {
      library = await api.remove(game.id);
      closeModal();
      toast(t('Entry removed. Game files remain untouched.'));
    } catch (e) {
      error(e);
    }
  }
  /** Apply preference `patch` now and persist it in order; `delay` coalesces path typing only. */
  function updatePreferences(patch: Partial<Settings>, delay = 0): void {
    draft = { ...draft, ...patch };
    if (patch.sound === false) feedback?.silence();
    settingsWriter?.update($state.snapshot(patch), delay);
  }

  /** Restore app defaults, preserving games, favorites, history and per-game artwork/install choices. */
  function restoreDefaults(): void {
    updatePreferences(resetPreferences($state.snapshot(draft)));
  }
  /** Focus the library search unless a modal or the settings page currently owns input. */

  function focusSearch() {
    if (modal || page === 'settings') return;
    searchInput?.focus();
  }
  /** Lazy-load the keyboard for editable `target` and isolate its draft from the underlying form. */
  async function openKeyboard(target: HTMLInputElement | HTMLTextAreaElement): Promise<void> {
    if (keyboardTarget || target.disabled || target.readOnly) return;
    keyboardSession = { target };
    try {
      ScreenKeyboard ??= (await import('./components/ScreenKeyboard.svelte')).default;
    } catch (cause) {
      finishKeyboard();
      error(cause);
    }
  }

  /** Commit optional `value` with fuzzy `matches` for search fallback, then restore the input's focus. */
  function finishKeyboard(value?: string, matches: readonly string[] = []): void {
    const target = keyboardTarget;
    keyboardSession = undefined;
    if (!target) return;
    if (value !== undefined) {
      target.value = value;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      if (target === searchInput && matches.length)
        fuzzySearch = { query: target.value, titles: new Set(matches) };
    }
    void tick().then(() => target.focus({ preventScroll: true }));
  }
  /** Dispatch semantic controller `action` to focused controls, navigation or game operations. */

  function controllerAction(action: string) {
    if (!modal && page !== 'settings' && ['shift', 'submit-text'].includes(action)) {
      void changeResultPage(action === 'submit-text' ? 1 : -1);
      return;
    }
    if (action === 'back') feedback?.play('back');
    else if (['settings', 'favorite', 'search', 'shift', 'submit-text'].includes(action))
      feedback?.play('confirm');
    else if (action === 'next' || action === 'previous') feedback?.play('navigate');
    const active = document.activeElement as HTMLElement | null;
    if (keyboardTarget) {
      if (action === 'back') finishKeyboard();
      else if (action === 'accept' && active?.closest('.screen-keyboard')) active.click();
      else keyboardPanel?.controllerShortcut(action);
      return;
    }
    if (action === 'accept') {
      if (
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLInputElement && active.type === 'text')
      ) {
        void openKeyboard(active);
      } else active?.click();
    }
    if (action === 'back') {
      if (closeActiveSelect()) return;
      if (modal) closeModal();
      else if (query) query = '';
      else navigate('home');
    }
    if (action === 'search' && !modal && page !== 'settings' && searchInput)
      void openKeyboard(searchInput);
    if (action === 'settings' && !modal) {
      closeActiveSelect();
      navigate(page === 'settings' ? 'home' : 'settings');
    }
    if (action === 'fullscreen') void toggleFullscreen();
    if (action === 'favorite' && !quitOpen) {
      const game = detail ?? library.games.find((g) => g.id === active?.dataset.game);
      if (game) void favorite(game);
    }
    if ((action === 'next' || action === 'previous') && !modal) {
      const pages: Page[] = ['home', 'library', 'favorites'];
      const index = pages.indexOf(page);
      navigate(pages[(index + (action === 'next' ? 1 : 2)) % 3]);
    }
  }
  /** Handle keyboard `event`, reserving text-editing shortcuts and trapping Tab within an open dialog. */

  function keydown(event: KeyboardEvent) {
    const editing =
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement;
    if (isFullscreenShortcut(event, navigator.platform)) {
      event.preventDefault();
      void toggleFullscreen();
      return;
    }
    if (event.key === 'Escape') {
      if (keyboardTarget) {
        event.preventDefault();
        finishKeyboard();
        return;
      }
      if (closeActiveSelect()) {
        event.preventDefault();
        return;
      }
      if (modal) closeModal();
      else if (query) {
        query = '';
        searchInput?.blur();
      } else if (fullscreen) void toggleFullscreen();
      return;
    }
    if (event.key === 'Tab' && modal) {
      const list = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-modal]:not([inert]) [data-nav]:not(:disabled)',
        ),
      ];
      const current = list.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && current <= 0) {
        event.preventDefault();
        list.at(-1)?.focus();
      } else if (!event.shiftKey && current === list.length - 1) {
        event.preventDefault();
        list[0]?.focus();
      }
    }
    if (editing || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === '/' && !keyboardTarget) {
      event.preventDefault();
      focusSearch();
    }
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      moveFocus(event.key.slice(5).toLowerCase());
    }
  }
  onMount(() => {
    const stopTooltips = manageTooltips();
    feedback = createSoundFeedback(() => draft.sound);
    let disposed = false;
    let stopCloseGuard: (() => void) | undefined;
    if (native)
      void api
        .guardClose(prepareClose, () => {
          page = 'settings';
        })
        .then((stop) => {
          if (disposed) stop();
          else stopCloseGuard = stop;
        })
        .catch(() => {
          /* Browser IPC fixtures may not implement native window events. */
        });
    void load();
    if (native)
      void api
        .providerIcons()
        .then((icons) => (providerIcons = icons))
        .catch(() => {})
        .finally(() => (providerIconsBusy = false));
    const stopFocusTracking = trackFocusVisibility();
    let lastShelfPage = -Infinity;
    /** Advance a bounded Home page after horizontal navigation reaches its edge. */
    function shelfPage(event: Event) {
      if (!shelf || modal || performance.now() - lastShelfPage < 250) return;
      const delta = (event as CustomEvent<number>).detail;
      if (delta !== 1 && delta !== -1) return;
      lastShelfPage = performance.now();
      void changeResultPage(delta);
    }
    document.addEventListener('shelf-page', shelfPage);
    const stopScrollbars = trackScrollbars();
    const stop = startController(
      (f, n) => {
        controllerFamily = f;
        controllerName = n;
      },
      controllerAction,
      () => family,
    );
    /** Refresh the automatic locale when the operating system/browser language preference changes. */
    function languageChanged() {
      systemLanguages = [...navigator.languages];
    }
    window.addEventListener('languagechange', languageChanged);
    const syncFullscreen = () => {
      if (!native) fullscreen = Boolean(document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => {
      stop();
      disposed = true;
      stopCloseGuard?.();
      feedback?.dispose();
      void settingsWriter?.flush();
      stopFocusTracking();
      document.removeEventListener('shelf-page', shelfPage);
      stopTooltips();
      stopScrollbars();
      window.removeEventListener('languagechange', languageChanged);
      clearTimeout(toastTimer);
      document.removeEventListener('fullscreenchange', syncFullscreen);
    };
  });
</script>

<svelte:window onkeydown={keydown} />

<div
  class="app-shell"
  class:reduced-motion={reducedMotion}
  class:solid={!draft.transparency}
  class:tv-mode={fullscreen}
>
  <div class="app-content" inert={modal}>
    <header class="topbar" class:hero-header={shelf && !!featured && !loadError && draft.artwork}>
      {#if !(shelf && featured && !loadError && draft.artwork)}
        <button
          class="brand"
          aria-label={t('Quickload home')}
          data-nav
          onclick={() => navigate('home')}
        >
          <img src="/icon.svg" alt="" /><span>quickload<span class="brand-period">.</span></span>
        </button>
      {/if}
      <nav
        aria-label={t('Main navigation')}
        class:inactive={page === 'settings'}
        style:--nav-index={page === 'library' ? 1 : page === 'favorites' ? 2 : 0}
      >
        <button
          data-nav
          aria-current={page === 'home' ? 'page' : undefined}
          class:active={page === 'home'}
          onclick={() => navigate('home')}>{t('For you')}</button
        >
        <button
          data-nav
          aria-current={page === 'library' ? 'page' : undefined}
          class:active={page === 'library'}
          onclick={() => navigate('library')}
          >{t('Library')} <span class="nav-count">{allCards.length}</span></button
        >
        <button
          data-nav
          aria-current={page === 'favorites' ? 'page' : undefined}
          class:active={page === 'favorites'}
          onclick={() => navigate('favorites')}>{t('Favorites')}</button
        >
      </nav>
      <div
        class="header-actions"
        class:with-shortcuts={usingController && (draft.controllerHints ?? true)}
      >
        {#if !native}<span class="preview-badge">{t('DESIGN PREVIEW')}</span>{/if}
        {#if native}<button
            data-nav
            class="icon-button"
            title={t('Quit Quickload')}
            aria-label={t('Quit Quickload')}
            onclick={openQuit}><Power size={19} /></button
          >{/if}
        <button
          data-nav
          class="icon-button"
          title={`${fullscreen ? t('Leave fullscreen') : t('Borderless fullscreen')} (${fullscreenHint} / F11)`}
          aria-label={t('Toggle fullscreen')}
          data-fullscreen
          onclick={toggleFullscreen}
          >{#if fullscreen}<Minimize size={19} />{:else}<Maximize size={19} />{/if}
          {#if usingController && (draft.controllerHints ?? true)}<span class="header-shortcut"
              ><Glyph button="menu" {family} /></span
            >{/if}</button
        >
        <button
          data-nav
          class="icon-button"
          class:selected={page === 'settings'}
          title={t('Settings')}
          aria-label={t('Settings')}
          onclick={() => navigate('settings')}
          ><SettingsIcon size={20} />
          {#if usingController && (draft.controllerHints ?? true)}<span class="header-shortcut"
              ><Glyph button="view" {family} /></span
            >{/if}</button
        >
        <div class="avatar" title={t('Local profile')}>V</div>
      </div>
    </header>

    <main class:home-main={shelf && !!featured && !loadError}>
      {#if loadError}
        <div class="empty-state">
          <CircleAlert size={36} />
          <h1>{t('Your library needs attention.')}</h1>
          <p>{loadError}</p>
          <button data-nav class="primary" onclick={load}>{t('Try again')}</button>
        </div>
      {:else if page === 'settings'}
        <section class="settings-page">
          <button class="back-link" data-nav onclick={() => navigate('home')}
            ><ArrowLeft size={17} /> {t('Back to your games')}</button
          >
          <p class="eyebrow">{t('THE WAY YOU PLAY')}</p>
          <h1>{t('Your setup.')}</h1>
          <p class="page-description">{t('Set it up. Sit back. Play.')}</p>
          <div class="settings-layout">
            <section class="settings-card">
              <div class="section-label">
                <Gamepad2 size={20} />
                <h2>{t('Controller')}</h2>
              </div>
              <SelectControl
                id="controller"
                label={t('Button symbols')}
                bind:value={
                  () => draft.controller,
                  (value) => updatePreferences({ controller: value as Settings['controller'] })
                }
                options={[
                  { value: 'auto', label: t('Detect automatically') },
                  { value: 'xbox', label: 'Xbox' },
                  { value: 'playstation', label: 'PlayStation' },
                  { value: 'nintendo', label: 'Nintendo Switch / Switch 2' },
                ]}
              />
              <p class="help-text">
                {controllerFamily
                  ? t('Connected: {name}', { name: controllerName })
                  : t('No controller active. Press a button on your controller.')}
                {t('Non-standard controllers need a system mapping.')}
              </p>
              <div class="glyph-preview">
                <Glyph button="a" {family} /><Glyph button="b" {family} /><Glyph
                  button="x"
                  {family}
                /><Glyph button="y" {family} /><span>{t('Current symbols')}</span>
              </div>
              <p class="help-text">
                {t('D-pad / left stick: navigate · Right stick: scroll')}
              </p>
              <div class="shortcut-help">
                <Glyph button="view" {family} /><span>{t('Settings')}</span><Glyph
                  button="menu"
                  {family}
                /><span>{t('Fullscreen')}</span>
              </div>
              <label class="toggle-row"
                ><span>{t('Show controller shortcuts')}</span><input
                  data-nav
                  type="checkbox"
                  role="switch"
                  checked={draft.controllerHints}
                  onchange={(event) =>
                    updatePreferences({ controllerHints: event.currentTarget.checked })}
                /></label
              >
              <p class="help-text">
                {t(
                  'Show button hints beside the settings and fullscreen icons. Shortcuts remain available.',
                )}
              </p>
              <label class="toggle-row">
                <span>{t('Global focus shortcut')}</span>
                <input
                  type="checkbox"
                  role="switch"
                  disabled={!native}
                  checked={draft.focusShortcutEnabled}
                  onchange={(event) =>
                    updatePreferences({ focusShortcutEnabled: event.currentTarget.checked })}
                />
              </label>
              <label class="shortcut-field">
                <span>{t('Focus key combination')}</span>
                <input
                  aria-label={t('Focus key combination')}
                  data-nav
                  value={draft.focusShortcut}
                  placeholder="Ctrl+Shift+F12"
                  onchange={(event) =>
                    updatePreferences({ focusShortcut: event.currentTarget.value.trim() })}
                />
              </label>
              <p class="help-text">
                {t(
                  'Disabled by default. Use at least two modifiers, for example Ctrl+Shift+F12. Conflicts are reported when saving. Assign the combination in your controller mapper.',
                )}
              </p>
            </section>
            <section class="settings-card">
              <div class="section-label">
                <Monitor size={20} />
                <h2>{t('Display')}</h2>
              </div>
              <SelectControl
                id="language"
                label={t('Language')}
                bind:value={
                  () => draft.language,
                  (value) => updatePreferences({ language: value as Settings['language'] })
                }
                options={[
                  { value: 'system', label: t('Follow system language') },
                  { value: 'de', label: 'Deutsch' },
                  { value: 'en', label: 'English' },
                ]}
              />
              <label class="toggle-row"
                ><span>{t('Transparent glass surfaces')}</span><input
                  data-nav
                  type="checkbox"
                  role="switch"
                  checked={draft.transparency}
                  onchange={(event) =>
                    updatePreferences({ transparency: event.currentTarget.checked })}
                /></label
              >
              <label class="toggle-row"
                ><span>{t('Reduce animations')}</span><input
                  data-nav
                  type="checkbox"
                  role="switch"
                  checked={draft.reducedMotion}
                  onchange={(event) =>
                    updatePreferences({ reducedMotion: event.currentTarget.checked })}
                /></label
              >
              <label class="toggle-row"
                ><span>{t('Interface sounds')}</span><input
                  data-nav
                  type="checkbox"
                  role="switch"
                  checked={draft.sound}
                  onchange={(event) => updatePreferences({ sound: event.currentTarget.checked })}
                /></label
              >
              <p class="help-text">
                {t('Quiet feedback for navigation, confirmation and going back.')}
              </p>
              <label class="toggle-row"
                ><span>{t('Load game artwork')}</span><input
                  data-nav
                  type="checkbox"
                  role="switch"
                  checked={draft.artwork}
                  onchange={(event) => updatePreferences({ artwork: event.currentTarget.checked })}
                /></label
              >
              <p class="help-text">
                {t(
                  'Quickload can show local and cached artwork. You can import covers in game details.',
                )}
              </p>
              <button data-nav data-fullscreen class="secondary" onclick={toggleFullscreen}
                ><Maximize size={16} />{fullscreen
                  ? t('Windowed mode')
                  : t('Borderless fullscreen')}</button
              >
              <p class="help-text">
                {t('{keys} or F11 toggles fullscreen without changing display resolution.', {
                  keys: fullscreenHint,
                })}
              </p>
            </section>
            <section class="settings-card wide">
              <div class="section-label">
                <Monitor size={20} />
                <h2>{t('Startup')}</h2>
              </div>
              <label class="toggle-row"
                ><span>{t('Start in fullscreen')}</span><input
                  data-nav
                  type="checkbox"
                  role="switch"
                  checked={draft.startupFullscreen}
                  disabled={!native}
                  onchange={(event) =>
                    updatePreferences({ startupFullscreen: event.currentTarget.checked })}
                /></label
              >
              <label class="toggle-row"
                ><span>{t('Open at login')}</span><input
                  data-nav
                  type="checkbox"
                  role="switch"
                  checked={draft.startAtLogin}
                  disabled={!loginAvailable && !draft.startAtLogin}
                  onchange={(event) =>
                    updatePreferences({ startAtLogin: event.currentTarget.checked })}
                /></label
              >
              {#if native && !loginAvailable}<p class="help-text">
                  {t('Login startup requires a packaged desktop build.')}
                </p>{/if}
              <p class="help-text">
                {native
                  ? t(
                      'Fullscreen applies the next time Quickload opens. Login startup uses this app installation.',
                    )
                  : t('Startup options are available in the desktop app.')}
              </p>
            </section>
            {#if native}
              <section class="settings-card wide">
                <div class="section-label">
                  <Download size={20} />
                  <h2>{t('Updates')}</h2>
                </div>
                {#if updatesAvailable}
                  <label class="toggle-row">
                    <span>{t('Automatically update Quickload')}</span>
                    <input
                      data-nav
                      type="checkbox"
                      role="switch"
                      checked={draft.automaticUpdates}
                      onchange={(event) =>
                        updatePreferences({ automaticUpdates: event.currentTarget.checked })}
                    />
                  </label>
                  <p class="help-text">
                    {t('Updates download in the background and install when you quit Quickload.')}
                  </p>
                  <button
                    class="text-button"
                    data-nav
                    aria-disabled={updateBusy || updateStatus === 'ready'}
                    onclick={() => void checkForUpdate()}>{t('Check for updates')}</button
                  >
                  {#if updateVersion}
                    <button
                      class="text-button"
                      data-nav
                      aria-disabled={updateBusy}
                      onclick={updateStatus === 'ready' ? installAndQuit : downloadUpdate}
                      >{t(
                        updateStatus === 'ready' ? 'Install and quit' : 'Download update',
                      )}</button
                    >
                  {/if}
                  <p class="help-text" role="status">
                    {#if updateStatus === 'checking'}{t('Checking for updates…')}
                    {:else if updateStatus === 'current'}{t('Quickload is up to date.')}
                    {:else if updateStatus === 'downloading'}{t('Downloading update…')}
                    {:else if updateStatus === 'ready'}{t(
                        'Version {version} is ready to install.',
                        { version: updateVersion ?? '' },
                      )}
                    {:else if updateStatus === 'error'}{t('The update could not be completed.')}
                    {:else if updateVersion}{t('Version {version} is available.', {
                        version: updateVersion,
                      })}
                    {/if}
                  </p>
                {:else}
                  <p class="help-text">{t('This build uses manual or package-manager updates.')}</p>
                  <button
                    class="text-button"
                    data-nav
                    onclick={() => void api.releaseDownloads().catch(error)}
                  >
                    {t('Open release downloads')}
                  </button>
                {/if}
              </section>
            {/if}
            <section class="settings-card wide">
              <div class="section-label">
                <FolderOpen size={20} />
                <h2>{t('Library sources')}</h2>
              </div>
              <label class="toggle-row"
                ><span>{t('Scan for games on startup')}</span><input
                  data-nav
                  type="checkbox"
                  role="switch"
                  checked={draft.startupScan}
                  onchange={(event) =>
                    updatePreferences({ startupScan: event.currentTarget.checked })}
                /></label
              >
              <p class="help-text">
                {t(
                  'Standard locations are detected automatically. Add other locations as one absolute path per line, then scan the library.',
                )}
              </p>
              <div class="path-grid">
                {#each [['steamRoots', t('Steam folders'), t('Folder containing steamapps')], ['epicRoots', t('Epic manifests'), t('Folder containing .item files')], ['gogRoots', t('GOG game folders'), t('Folder containing goggame-*.info')]] as [key, label, placeholder]}
                  <label
                    >{label}<textarea
                      data-nav
                      rows="3"
                      {placeholder}
                      value={draft[key as 'steamRoots' | 'epicRoots' | 'gogRoots'].join('\n')}
                      oninput={(e) =>
                        updatePreferences({ [key]: e.currentTarget.value.split('\n') }, 250)}
                      onblur={() => void settingsWriter?.flush()}></textarea></label
                  >
                {/each}
              </div>
              <div class="source-support">
                <span><Check size={14} /> Steam</span><span><Check size={14} /> Epic / Heroic</span
                ><span><Check size={14} /> GOG / Heroic</span><span
                  ><Monitor size={14} /> Xbox: Windows</span
                >
                <span><Monitor size={14} /> Ubisoft Connect: Windows</span>
                <span><Monitor size={14} /> Battle.net: Windows</span>
                <span><Monitor size={14} /> Rockstar Games: Windows</span>
              </div>
              <p class="help-text">
                {t(
                  'Only local installations are detected. Store clients manage sign-in, purchases, downloads and cloud saves. Windows games on Linux require a suitable Heroic/Steam configuration.',
                )}
              </p>
            </section>
            {#if native}
              <section class="settings-card wide">
                <div class="section-label">
                  <ImagePlus size={20} />
                  <h2>{t('Provider icons')}</h2>
                </div>
                <p class="help-text">
                  {t('Choose a local SVG up to 64 KiB for each provider. Quickload keeps a copy.')}
                </p>
                <button
                  class="text-button"
                  data-nav
                  aria-disabled={providerIconsBusy}
                  onclick={() => void importProviderIcons()}>{t('Import SVG folder')}</button
                >
                <p class="help-text">
                  {t('Match SVG filenames in the selected folder. Existing icons are kept.')}
                </p>
                {#each stores as store (store)}
                  {#if store !== 'manual'}
                    <div class="provider-icon-row">
                      <span
                        ><ProviderIcon svg={providerIcons[store]} />{storeName(store, locale)}</span
                      >
                      <div>
                        <button
                          class="text-button"
                          data-nav
                          aria-disabled={providerIconsBusy}
                          aria-label={t('Choose SVG for {provider}', {
                            provider: storeName(store, locale),
                          })}
                          onclick={() => void changeProviderIcon(store)}>{t('Choose SVG')}</button
                        >
                        {#if providerIcons[store]}
                          <button
                            class="text-button"
                            data-nav
                            aria-disabled={providerIconsBusy}
                            aria-label={t('Remove icon for {provider}', {
                              provider: storeName(store, locale),
                            })}
                            onclick={(event) => {
                              event.currentTarget.parentElement?.querySelector('button')?.focus();
                              void changeProviderIcon(store, true);
                            }}>{t('Remove icon')}</button
                          >
                        {/if}
                      </div>
                    </div>
                  {/if}
                {/each}
              </section>
            {/if}
          </div>
          <div class="settings-bottom">
            <span
              >Quickload {version} · {t('Local library')} · {native
                ? 'Desktop'
                : t('Browser preview')}</span
            >
            <div class="preference-feedback">
              <span role="status" aria-live="polite" class:save-error={preferenceStatus === 'error'}
                >{preferenceStatus === 'saving'
                  ? t('Saving …')
                  : preferenceStatus === 'error'
                    ? t('Changes could not be saved.')
                    : t('All changes saved automatically.')}</span
              >
              {#if preferenceStatus === 'error'}<p>{preferenceError}</p>
                <button data-nav class="secondary" onclick={() => void settingsWriter?.flush()}
                  >{t('Try again')}</button
                >{/if}
              <button data-nav class="secondary" onclick={restoreDefaults}
                >{t('Restore defaults')}</button
              >
              <p class="help-text">
                {t(
                  'Resets app settings and library folders. Your games, favorites and per-game choices are kept.',
                )}
              </p>
            </div>
          </div>
        </section>
      {:else}
        {#if shelf && featured}
          <section class="hero" aria-label={t('In focus')}>
            <div class="hero-art" hidden={!draft.artwork}>
              <Artwork
                game={featured}
                kind="hero"
                position={draft.artworkPositions?.[featured.id]?.hero}
                enabled={draft.artwork}
                eager
                revision={artworkRevision}
              />
            </div>
            <div class="hero-vignette"></div>
            <div class="hero-grain"></div>
            <div class="hero-content">
              <p class="hero-kicker">{t('YOUR NEXT GAME')}</p>
              <h1><span>{featured.title}</span></h1>
              <div class="hero-meta">
                <span class="hero-store">{storeName(featured.store, locale)}</span><span>·</span
                ><span>{featured.installed ? t('Ready to play') : t('Not installed')}</span
                >{#if featured.favorite}<span>·</span><Heart size={13} fill="currentColor" /><span
                    >{t('Favorite')}</span
                  >{/if}
              </div>
              <p class="hero-description">{t('Back to your world.')}</p>
              <div class="hero-buttons">
                <button
                  class="primary play-button"
                  data-nav
                  disabled={!featured.installed || launching}
                  onclick={() => launch(featured)}
                  ><Play size={17} fill="currentColor" />
                  {launching ? t('Launching …') : t('Play')}
                  {#if usingController}<Glyph button="a" {family} />{:else}<kbd class="keycap"
                      >↵</kbd
                    >{/if}</button
                ><button
                  class="hero-more"
                  data-nav
                  aria-label={t('Show game details')}
                  onclick={() => openDetail(featured)}
                  >{t('Details')} <ChevronRight size={17} /></button
                >
              </div>
            </div>
            <div class="hero-bottom">
              <span class="hero-line"></span><span>{t('YOUR GAMES. YOUR MOMENT.')}</span><span
                class="hero-index"
                >01 <span>/ {String(allCards.length).padStart(2, '0')}</span></span
              >
            </div>
          </section>
        {/if}

        <section class="library-section" class:library-full={!shelf}>
          <div class="library-heading">
            <div>
              <h1>
                {query
                  ? t('Your search')
                  : page === 'favorites'
                    ? t('Favorites')
                    : page === 'library'
                      ? t('Library')
                      : t('Your games')}{#if page === 'home' && allCards.length}<span
                    class="heading-count">{allCards.length}</span
                  >{/if}
              </h1>
            </div>
            <div class="library-tools">
              <div class="search-box">
                <Search size={17} /><input
                  data-nav
                  bind:this={searchInput}
                  bind:value={query}
                  oninput={() => (fuzzySearch = undefined)}
                  aria-label={t('Search games')}
                  placeholder={t('Search games')}
                /><button
                  data-nav
                  class="search-clear"
                  disabled={!query}
                  aria-label={t('Clear search')}
                  title={t('Clear search')}
                  onclick={() => {
                    query = '';
                    fuzzySearch = undefined;
                    searchInput?.focus({ preventScroll: true });
                  }}><X size={16} /></button
                >
                {#if usingController}<Glyph button="y" {family} />{:else}<kbd>/</kbd>{/if}
              </div>
              <button
                data-nav
                class="icon-button bordered"
                aria-label={t('Add game')}
                title={t('Add your own game')}
                onclick={openAdd}><Plus size={19} /></button
              ><button
                data-nav
                class="icon-button bordered"
                disabled={scanning}
                aria-label={t('Scan library')}
                title={t('Scan library')}
                onclick={scan}><RefreshCw size={17} class={scanning ? 'spinning' : ''} /></button
              >
            </div>
          </div>
          <div class="filter-row">
            <div class="store-filters" aria-label={t('Filter by store')}>
              <button data-nav class:chosen={source === 'all'} onclick={() => selectStore('all')}
                >{t('All games')} <span>{allCards.length}</span></button
              >{#each stores.filter( (s) => library.games.some((g) => g.store === s) ) as store}<button
                  data-nav
                  class:chosen={source === store}
                  onclick={() => selectStore(store)}
                  ><ProviderIcon svg={providerIcons[store]} />{storeName(store, locale).split(
                    ' · ',
                  )[0]}</button
                >{/each}
            </div>
            <div class="sort-select">
              <SelectControl
                id="library-sort"
                label={t('Sort games')}
                hideLabel
                bind:value={() => sort, (value) => (sort = value === 'title' ? 'title' : 'recent')}
                options={[
                  { value: 'recent', label: t('Recently played') },
                  { value: 'title', label: t('Alphabetical') },
                ]}
              />
            </div>
          </div>
          {#if loading}<div class="loading-state">
              <RefreshCw size={22} class="spinning" />{t('Loading your library …')}
            </div>
          {:else if filtered.length}
            <div class:game-grid={!shelf} class:game-shelf={shelf}>
              {#each visibleGames as game (game.id)}<GameCard
                  {game}
                  {locale}
                  artwork={draft.artwork}
                  revision={artworkRevision}
                  position={draft.artworkPositions?.[game.id]?.cover}
                  onselect={() => openDetail(game)}
                  onfocus={() => (featuredId = game.id)}
                />{/each}
            </div>
            {#if filtered.length > pageSize}<div class="pagination">
                <button
                  data-nav
                  class="secondary"
                  disabled={resultPage === 0}
                  onclick={() => changeResultPage(-1)}
                  >{#if usingController}<Glyph button="lt" {family} />{:else}<ArrowLeft
                      size={15}
                    />{/if}{t('Back')}</button
                ><span
                  >{t('Page {page} / {pages} · {count} games', {
                    page: resultPage + 1,
                    pages: Math.ceil(filtered.length / pageSize),
                    count: filtered.length,
                  })}</span
                ><button
                  data-nav
                  class="secondary"
                  disabled={(resultPage + 1) * pageSize >= filtered.length}
                  onclick={() => changeResultPage(1)}
                  >{t('Next')}{#if usingController}<Glyph
                      button="rt"
                      {family}
                    />{:else}<ChevronRight size={15} />{/if}</button
                >
              </div>{/if}
            {#if shelf && filtered.length > 20 && !fullscreen}
              <button data-nav class="show-all" onclick={() => navigate('library')}>
                {t('View all {count} games', { count: filtered.length })}<ChevronRight size={15} />
              </button>
            {/if}
          {:else}<div class="empty-state">
              <LibraryIcon size={36} />
              <h2>
                {query
                  ? t('No results yet.')
                  : page === 'favorites'
                    ? t('Room for your favorites.')
                    : t('Your next adventure starts here.')}
              </h2>
              <p>
                {query
                  ? t('Try another game title or store filter.')
                  : page === 'favorites'
                    ? 'Markiere ein Spiel mit dem Herz oder X / □ auf deinem Controller.'
                    : t('Scan installed games or add your own game.')}
              </p>
              {#if query || source !== 'all'}<button
                  data-nav
                  class="secondary"
                  onclick={() => {
                    query = '';
                    source = 'all';
                  }}>{t('Reset filters')}</button
                >{:else if page !== 'favorites'}<div class="empty-actions">
                  <button data-nav class="primary" onclick={scan} disabled={scanning}
                    ><RefreshCw size={16} />{scanning
                      ? t('Scanning …')
                      : t('Discover games')}</button
                  ><button data-nav class="secondary" onclick={openAdd}
                    ><Plus size={16} />{t('Your own game')}</button
                  >
                </div>{/if}
            </div>{/if}
          {#if warnings.length}<details class="scan-warnings">
              <summary
                ><CircleAlert size={15} />{t('{count} discovery notes', {
                  count: warnings.length,
                })}</summary
              >{#each warnings as warning}<p>{warning}</p>{/each}
            </details>{/if}
          <div class="library-status">
            <span
              ><span class="status-dot"></span>{!native
                ? t('Example library · No real installations')
                : scanning
                  ? t('Scanning local libraries …')
                  : t('{count} games ready to play', { count: installed })}</span
            ><span
              >{scanMs !== null
                ? t('Last scan: {duration}', { duration: formatDuration(scanMs, locale) })
                : native
                  ? t('Local. No Quickload account.')
                  : t('Local discovery in the desktop app')}</span
            >
          </div>
        </section>
      {/if}
    </main>
    <footer>
      <div class="controller-status" title={controllerName}>
        <Gamepad2 size={17} /><span
          >{controllerFamily
            ? t('{family} connected', {
                family:
                  family === 'playstation'
                    ? 'PlayStation'
                    : family === 'nintendo'
                      ? 'Nintendo'
                      : 'Xbox',
              })
            : t('Keyboard & mouse')}
        </span>{#if controllerFamily}<span class="status-dot"></span>{/if}
      </div>
      <div class="control-hints">
        <span
          >{#if usingController}<Glyph button="a" {family} />{:else}<kbd class="keycap">↵</kbd>{/if}
          {t('Select')}</span
        ><span
          >{#if usingController}<Glyph button="b" {family} />{:else}<kbd class="keycap">esc</kbd
            >{/if}
          {t('Back')}</span
        ><span
          >{#if usingController}<Glyph button="x" {family} /> {t('Favorite')}{:else}<kbd
              class="keycap">tab</kbd
            >
            {t('Navigate')}{/if}</span
        >{#if usingController}<span class="scroll-hint">{t('Right stick · Scroll')}</span>{/if}<span
          class="fullscreen-hint"
          >{#if usingController}<Glyph button="menu" {family} />{:else}<kbd>{fullscreenHint}</kbd
            >{/if}
          {t('Fullscreen')}</span
        >
      </div>
      <span class="footer-tagline">{t('LESS SEARCHING. MORE PLAYING.')}</span>
    </footer>
  </div>

  {#if quitOpen}
    <div class="modal-backdrop">
      <dialog open data-modal aria-labelledby="quit-title" class="quit-modal">
        <span class="modal-symbol"><Power size={25} /></span>
        <h1 id="quit-title">{t('Quit Quickload?')}</h1>
        <p class="page-description">{t('Your changes are saved before the app closes.')}</p>
        <div class="quit-actions">
          <button data-nav class="secondary quit-cancel" onclick={closeModal}>{t('Cancel')}</button>
          <button data-nav class="primary" onclick={quit}
            ><Glyph button="a" {family} />{t('Quit')}</button
          >
        </div>
      </dialog>
    </div>
  {/if}
  {#if detail}
    <div class="modal-backdrop">
      <dialog open data-modal aria-labelledby="detail-title" class="detail-modal">
        <button
          data-nav
          class="icon-button modal-close"
          aria-label={t('Close')}
          onclick={closeModal}><X size={21} /></button
        >
        <div class="detail-art">
          <Artwork
            game={detail}
            kind="cover"
            layout="detail"
            enabled={draft.artwork}
            eager
            revision={artworkRevision}
          />
        </div>
        <div class="detail-content">
          <p class="eyebrow">{storeName(detail.store, locale)}</p>
          <h1 id="detail-title">{detail.title}</h1>
          <p class="detail-status">
            <span class="status-dot"></span>{detail.installed
              ? t('Installed · Ready for your next adventure')
              : t('Installation no longer found')}
          </p>
          {#if detailGroup && detailGroup.installations.length > 1}
            <div class="detail-installation">
              <SelectControl
                id="preferred-installation"
                label={t('Preferred installation')}
                bind:value={() => detail?.id ?? '', (id) => void preferInstallation(id)}
                options={detailGroup.installations.map((game) => ({
                  value: game.id,
                  label: game.installed
                    ? storeName(game.store, locale)
                    : `${storeName(game.store, locale)} · ${t('Not installed')}`,
                }))}
              />
            </div>
          {/if}
          <div class="detail-stats">
            <div>
              <span>{t('LAST PLAYED')}</span><strong
                >{detail.id.startsWith('demo:')
                  ? t('Example data')
                  : detail.lastPlayed
                    ? new Date(detail.lastPlayed * 1000).toLocaleDateString(locale)
                    : t('Not yet')}</strong
              >
            </div>
            <div>
              <span>{t('LAUNCHES WITH QUICKLOAD')}</span><strong
                >{detail.id.startsWith('demo:') ? '—' : detail.launchCount}</strong
              >
            </div>
          </div>
          <div class="detail-actions">
            <button
              data-nav
              class="primary detail-play"
              disabled={!detail.installed}
              aria-disabled={launching}
              onclick={() => launch(detail)}
              ><Play size={17} fill="currentColor" />{launching
                ? t('Launching …')
                : t('Play')}{#if usingController}<Glyph button="a" {family} />{:else}<kbd
                  class="keycap"
                  aria-hidden="true">↵</kbd
                >{/if}</button
            ><button
              data-nav
              class="secondary"
              class:is-favorite={detail.favorite}
              onclick={() => favorite(detail)}
              ><Heart size={17} fill={detail.favorite ? 'currentColor' : 'none'} />{detail.favorite
                ? t('Favorite')
                : t('Remember')}</button
            >{#if detail.store === 'manual'}<button
                data-nav
                class="text-button"
                onclick={() => removeManual(detail)}>{t('Remove entry')}</button
              >{/if}
          </div>
          {#if lastLaunch?.id === detail.id}
            <div class="launch-diagnostic">
              <p role="status">{launchMessage(lastLaunch.report)}</p>
              {#if lastLaunch.report.error}<p>{t(lastLaunch.report.error)}</p>{/if}
              <button data-nav class="secondary" onclick={copyLaunch}
                >{t('Copy launch diagnostic')}</button
              >
              <textarea
                data-nav
                readonly
                rows="3"
                aria-label={t('Launch diagnostic')}
                value={JSON.stringify(lastLaunch, null, 2)}></textarea>
            </div>
          {/if}
          <button data-nav class="cover-edit" onclick={() => chooseCover(detail)}
            ><ImagePlus size={16} />{t('Change cover')}</button
          >
          <button
            data-nav
            class="cover-edit artwork-frame-trigger"
            aria-expanded={editingArtwork}
            onclick={() => (editingArtwork = !editingArtwork)}>{t('Artwork framing')}</button
          >
          {#if editingArtwork}
            <ArtworkFraming
              game={detail}
              {locale}
              initial={draft.artworkPositions?.[detail.id]}
              enabled={draft.artwork}
              {saving}
              onsave={saveArtworkPositions}
            />
          {/if}
          {#if !native}<p class="help-text">
              {t('Design preview: this example game cannot be launched here.')}
            </p>{/if}
        </div>
      </dialog>
    </div>
  {/if}
  {#if addOpen}
    <div class="modal-backdrop">
      <dialog
        open
        data-modal
        inert={!!keyboardTarget}
        aria-labelledby="add-title"
        class="add-modal"
      >
        <button
          data-nav
          class="icon-button modal-close"
          aria-label={t('Close')}
          onclick={closeModal}><X size={21} /></button
        ><span class="modal-symbol"><Plus size={25} /></span>
        <p class="eyebrow">{t('YOUR LIBRARY IS GROWING')}</p>
        <h1 id="add-title">{t('A new adventure.')}</h1>
        <p class="page-description">{t('Add a locally installed game.')}</p>
        <form onsubmit={addGame}>
          <label
            >{t('Game title')}<input
              data-nav
              required
              maxlength="160"
              placeholder={t('What is your game called?')}
              bind:value={manualTitle}
            /></label
          ><label
            >{t('Executable file')}
            <div class="file-input">
              <input
                data-nav
                required
                placeholder={t('Absolute path to the game file')}
                bind:value={manualPath}
              /><button
                data-nav
                type="button"
                class="icon-button bordered"
                aria-label={t('Choose file')}
                onclick={pickFile}><FolderOpen size={18} /></button
              >
            </div></label
          >
          <p class="help-text">
            {t(
              'Windows: .exe · macOS: .app or executable · Linux: native executable. Import Wine games through Steam or Heroic.',
            )}
          </p>
          <button data-nav class="primary" type="submit" disabled={saving}
            >{saving ? t('Adding …') : t('Add to library')}<Plus size={17} /></button
          >
        </form>
      </dialog>
    </div>
  {/if}
  {#each keyboardSession && ScreenKeyboard ? [keyboardSession] : [] as session (session)}
    <ScreenKeyboard
      bind:this={keyboardPanel}
      target={session.target}
      {locale}
      {family}
      {reducedMotion}
      titles={keyboardTitles}
      onfinish={finishKeyboard}
    />
  {/each}
  {#if notice}<div class="toast" role="status">
      <Sparkles size={17} /><span>{notice}</span><button
        class="icon-button"
        aria-label={t('Dismiss notification')}
        onclick={() => (notice = '')}><X size={16} /></button
      >
    </div>{/if}
</div>
