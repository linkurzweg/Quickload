import type { Language, Store } from './types';

/** Supported UI locale; translation keys are the complete English fallback messages. */
export type Locale = 'de' | 'en';

const german: Record<string, string> = {
  'Global focus shortcut': 'Globaler Shortcut zum Aufrufen',
  'Focus key combination': 'Tastenkombination zum Aufrufen',
  'Disabled by default. Use at least two modifiers, for example Ctrl+Shift+F12. Conflicts are reported when saving. Assign the combination in your controller mapper.':
    'Standardmäßig deaktiviert. Verwende mindestens zwei Zusatztasten, z. B. Ctrl+Shift+F12. Belegungskonflikte werden beim Speichern angezeigt. Weise die Kombination in deiner Controller-Belegung zu.',
  'Clear input': 'Eingabe leeren',
  'Clear search': 'Suche leeren',
  Cancel: 'Abbrechen',
  'Quit Quickload': 'Quickload beenden',
  'Quit Quickload?': 'Quickload beenden?',
  Quit: 'Beenden',
  'Your changes are saved before the app closes.':
    'Deine Änderungen werden vor dem Beenden gespeichert.',
  'Closing is available in the desktop app.': 'Beenden ist in der Desktop-App verfügbar.',
  'Game process detected': 'Spielprozess erkannt',
  'Game launch failed': 'Spielstart fehlgeschlagen',
  'Launch handed over · Game process not confirmed':
    'Start übergeben · Spielprozess nicht bestätigt',
  'Launch diagnostic copied': 'Startdiagnose kopiert',
  'Copy launch diagnostic': 'Startdiagnose kopieren',
  'Launch diagnostic': 'Startdiagnose',
  'Preferred installation': 'Bevorzugte Installation',
  'Artwork framing': 'Bildausschnitt',
  Cover: 'Cover',
  'Hero artwork': 'Hero-Bild',
  'Move crop left': 'Ausschnitt nach links',
  'Move crop right': 'Ausschnitt nach rechts',
  'Move crop up': 'Ausschnitt nach oben',
  'Move crop down': 'Ausschnitt nach unten',
  'Reset framing': 'Ausschnitt zurücksetzen',
  'Save framing': 'Ausschnitt speichern',
  'On-screen keyboard': 'Bildschirmtastatur',
  'Library suggestions': 'Vorschläge aus deiner Bibliothek',
  'Type to find a game in your library': 'Tippe, um ein Spiel in deiner Bibliothek zu finden',
  'Delete character': 'Zeichen löschen',
  Shift: 'Umschalt',
  Symbols: 'Sonderzeichen',
  Space: 'Leerzeichen',
  Cursor: 'Textcursor',
  Done: 'Fertig',
  'Your next adventure': 'Dein nächstes Abenteuer',
  'For you': 'Für dich',
  Library: 'Bibliothek',
  Favorites: 'Favoriten',
  'Quickload home': 'Quickload Startseite',
  'Main navigation': 'Hauptnavigation',
  'DESIGN PREVIEW': 'DESIGNVORSCHAU',
  Settings: 'Einstellungen',
  'Toggle fullscreen': 'Vollbild umschalten',
  'Leave fullscreen': 'Vollbild verlassen',
  'Borderless fullscreen': 'Randloses Vollbild',
  'Local profile': 'Lokales Profil',
  'Your library needs attention.': 'Die Bibliothek braucht deine Aufmerksamkeit.',
  'Try again': 'Erneut versuchen',
  'Back to your games': 'Zurück zu deinen Spielen',
  'THE WAY YOU PLAY': 'GANZ WIE DU SPIELST',
  'Your setup.': 'Dein Setup.',
  'Set it up. Sit back. Play.': 'Einmal einstellen. Zurücklehnen. Losspielen.',
  Controller: 'Controller',
  'Button symbols': 'Tastensymbole',
  'Detect automatically': 'Automatisch erkennen',
  'Current symbols': 'Aktuelle Symbole',
  'No controller active. Press a button on your controller.':
    'Kein Controller aktiv. Drücke eine Taste auf deinem Controller.',
  'Connected: {name}': 'Verbunden: {name}',
  '{family} connected': '{family} verbunden',
  'Non-standard controllers need a system mapping.':
    'Nicht standardisierte Controller benötigen ein Betriebssystem-Mapping.',
  'D-pad / left stick: navigate · Right stick: scroll':
    'Steuerkreuz / linker Stick: Navigation · Rechter Stick: Scrollen',
  Display: 'Darstellung',
  'Transparent glass surfaces': 'Transparente Glasflächen',
  'Reduce animations': 'Animationen reduzieren',
  'Interface sounds': 'Bedienungstöne',
  'Quiet feedback for navigation, confirmation and going back.':
    'Dezente Töne beim Navigieren, Bestätigen und Zurückgehen.',
  Startup: 'App-Start',
  Updates: 'Updates',
  'Automatically update Quickload': 'Quickload automatisch aktualisieren',
  'Updates download in the background and install when you quit Quickload.':
    'Updates werden im Hintergrund geladen und beim Beenden von Quickload installiert.',
  'Check for updates': 'Nach Updates suchen',
  'Checking for updates…': 'Suche nach Updates …',
  'Quickload is up to date.': 'Quickload ist auf dem neuesten Stand.',
  'Downloading update…': 'Update wird heruntergeladen …',
  'Version {version} is available.': 'Version {version} ist verfügbar.',
  'Version {version} is ready to install.': 'Version {version} ist zur Installation bereit.',
  'Download update': 'Update herunterladen',
  'Install and quit': 'Installieren und beenden',
  'The update could not be completed.': 'Das Update konnte nicht abgeschlossen werden.',
  'The update could not be installed.': 'Das Update konnte nicht installiert werden.',
  'This build uses manual or package-manager updates.':
    'Diese Version wird manuell oder über die Paketverwaltung aktualisiert.',
  'Open release downloads': 'Release-Downloads öffnen',
  'Start in fullscreen': 'Im Vollbild starten',
  'Open at login': 'Bei der Anmeldung öffnen',
  'Login startup requires a packaged desktop build.':
    'Autostart benötigt einen eigenständig startbaren Desktop-Build.',
  'Fullscreen applies the next time Quickload opens. Login startup uses this app installation.':
    'Vollbild gilt beim nächsten Öffnen von Quickload. Der Autostart verwendet diese App-Installation.',
  'Startup options are available in the desktop app.':
    'Startoptionen sind in der Desktop-App verfügbar.',
  'All changes saved automatically.': 'Alle Änderungen automatisch gespeichert.',
  'Changes could not be saved.': 'Änderungen konnten nicht gespeichert werden.',
  'Restore defaults': 'Standards wiederherstellen',
  'Resets app settings and library folders. Your games, favorites and per-game choices are kept.':
    'Setzt App-Einstellungen und Bibliotheksordner zurück. Spiele, Favoriten und Einstellungen einzelner Spiele bleiben erhalten.',
  'Standard locations are detected automatically. Add other locations as one absolute path per line, then scan the library.':
    'Standardordner werden automatisch erkannt. Ergänze weitere Ordner mit einem absoluten Pfad pro Zeile und scanne anschließend die Bibliothek.',
  'Load game artwork': 'Spielbilder laden',
  'Show controller shortcuts': 'Controller-Shortcuts anzeigen',
  'Show button hints beside the settings and fullscreen icons. Shortcuts remain available.':
    'Tastenhinweise neben den Einstellungen- und Vollbild-Icons anzeigen. Die Shortcuts bleiben verfügbar.',
  Language: 'Sprache',
  'Follow system language': 'Systemsprache übernehmen',
  'Quickload can show local and cached artwork. You can import covers in game details.':
    'Quickload kann lokale und zwischengespeicherte Bilder anzeigen. Eigene Cover kannst du in den Spieldetails auswählen.',
  'Windowed mode': 'Fenstermodus',
  '{keys} or F11 toggles fullscreen without changing display resolution.':
    '{keys} oder F11 schaltet Vollbild um. Die Desktop-Auflösung bleibt erhalten.',
  'Library sources': 'Bibliotheksquellen',
  'Provider icons': 'Anbieter-Symbole',
  'Choose provider icon': 'Anbieter-Symbol auswählen',
  'Choose SVG': 'SVG auswählen',
  'Choose SVG for {provider}': 'SVG für {provider} auswählen',
  'SVG image': 'SVG-Bild',
  'Remove icon': 'Symbol entfernen',
  'Remove icon for {provider}': 'Symbol für {provider} entfernen',
  'Provider icon removed.': 'Anbieter-Symbol entfernt.',
  'Provider icon saved.': 'Anbieter-Symbol gespeichert.',
  'Choose a valid SVG file up to 64 KiB.': 'Wähle eine gültige SVG-Datei bis 64 KiB aus.',
  'Choose a local SVG up to 64 KiB for each provider. Quickload keeps a copy.':
    'Wähle pro Anbieter eine lokale SVG-Datei bis 64 KiB aus. Quickload speichert eine Kopie.',
  'Scan for games on startup': 'Beim Start nach Spielen suchen',
  'Standard locations are detected automatically. Add other locations as one absolute path per line. Save, then scan the library.':
    'Standardpfade werden automatisch erkannt. Ergänze abweichende Speicherorte, einen absoluten Pfad pro Zeile. Nach dem Speichern „Bibliothek scannen“ wählen.',
  'Steam folders': 'Steam-Ordner',
  'Folder containing steamapps': 'Ordner mit steamapps',
  'Epic manifests': 'Epic-Manifeste',
  'Folder containing .item files': 'Ordner mit .item-Dateien',
  'GOG game folders': 'GOG-Spieleordner',
  'Folder containing goggame-*.info': 'Ordner mit goggame-*.info',
  'Only local installations are detected. Store clients manage sign-in, purchases, downloads and cloud saves. Windows games on Linux require a suitable Heroic/Steam configuration.':
    'Erkannt werden lokale Installationen. Store-Anmeldung, Käufe, Downloads und Cloud-Saves übernimmt weiterhin der jeweilige Store. Windows-Spiele benötigen unter Linux eine passende Heroic-/Steam-Konfiguration.',
  'Local library': 'Lokale Bibliothek',
  'Browser preview': 'Browser-Vorschau',
  'Saving …': 'Speichern …',
  'Save settings': 'Einstellungen speichern',
  'In focus': 'Im Fokus',
  'YOUR NEXT GAME': 'DEIN NÄCHSTES SPIEL',
  'Ready to play': 'Bereit zum Spielen',
  'Not installed': 'Nicht installiert',
  Favorite: 'Favorit',
  'Back to your world.': 'Zurück in deine Welt.',
  'Launching …': 'Wird gestartet …',
  Play: 'Spielen',
  'Show game details': 'Spieldetails anzeigen',
  Details: 'Details',
  'YOUR GAMES. YOUR MOMENT.': 'DEINE SPIELE. DEIN MOMENT.',
  'Your search': 'Deine Suche',
  'Your games': 'Deine Spiele',
  'Search games': 'Spiele suchen',
  'Add game': 'Spiel hinzufügen',
  'Add your own game': 'Eigenes Spiel hinzufügen',
  'Scan library': 'Bibliothek scannen',
  'Filter by store': 'Store filtern',
  'All games': 'Alle Spiele',
  'Sort games': 'Spiele sortieren',
  'Recently played': 'Zuletzt gestartet',
  Alphabetical: 'Alphabetisch',
  'Loading your library …': 'Deine Bibliothek wird geladen …',
  Back: 'Zurück',
  Next: 'Weiter',
  'Page {page} / {pages} · {count} games': 'Seite {page} / {pages} · {count} Spiele',
  'View all {count} games': 'Alle {count} Spiele ansehen',
  'No results yet.': 'Noch kein Treffer.',
  'Room for your favorites.': 'Platz für deine Lieblingsspiele.',
  'Your next adventure starts here.': 'Dein nächstes Abenteuer beginnt hier.',
  'Try another game title or store filter.': 'Versuche einen anderen Spielnamen oder Store-Filter.',
  'Mark games with the heart or the favorite button on your controller.':
    'Markiere Spiele mit dem Herz oder der Favoriten-Taste auf deinem Controller.',
  'Scan installed games or add your own game.':
    'Scanne deine installierten Spiele oder füge ein eigenes Spiel hinzu.',
  'Reset filters': 'Filter zurücksetzen',
  'Scanning …': 'Wird gesucht …',
  'Discover games': 'Spiele entdecken',
  'Your own game': 'Eigenes Spiel',
  '{count} discovery notes': '{count} Hinweise zur Erkennung',
  'Example library · No real installations': 'Beispielbibliothek · Keine echten Installationen',
  'Scanning local libraries …': 'Lokale Bibliotheken werden durchsucht …',
  '{count} games ready to play': '{count} Spiele startbereit',
  'Last scan: {duration}': 'Letzter Scan: {duration}',
  'Local. No Quickload account.': 'Lokal. Ohne Quickload-Konto.',
  'Local discovery in the desktop app': 'Lokale Erkennung in der Desktop-App',
  'Keyboard & mouse': 'Tastatur & Maus',
  Select: 'Auswählen',
  Navigate: 'Navigieren',
  'Right stick · Scroll': 'R-Stick · Scrollen',
  Fullscreen: 'Vollbild',
  'LESS SEARCHING. MORE PLAYING.': 'WENIGER SUCHEN. MEHR SPIELEN.',
  Close: 'Schließen',
  'Installed · Ready for your next adventure': 'Installiert · Bereit für dein nächstes Abenteuer',
  'Installation no longer found': 'Installation nicht mehr gefunden',
  'LAST PLAYED': 'ZULETZT GESTARTET',
  'Example data': 'Beispieldaten',
  'Not yet': 'Noch nicht',
  'LAUNCHES WITH QUICKLOAD': 'STARTS MIT QUICKLOAD',
  Remember: 'Merken',
  'Remove entry': 'Eintrag entfernen',
  'Change cover': 'Cover ändern',
  'Design preview: this example game cannot be launched here.':
    'Designvorschau: Dieses Beispielspiel kann hier nicht gestartet werden.',
  'YOUR LIBRARY IS GROWING': 'DEINE BIBLIOTHEK WÄCHST',
  'A new adventure.': 'Ein neues Abenteuer.',
  'Add a locally installed game.': 'Füge ein lokal installiertes Spiel hinzu.',
  'Game title': 'Spielname',
  'What is your game called?': 'Wie heißt dein Spiel?',
  'Executable file': 'Ausführbare Datei',
  'Absolute path to the game file': 'Absoluter Pfad zur Spieldatei',
  'Choose file': 'Datei auswählen',
  'Windows: .exe · macOS: .app or executable · Linux: native executable. Import Wine games through Steam or Heroic.':
    'Windows: .exe · macOS: .app oder ausführbare Datei · Linux: native ausführbare Datei. Wine-Spiele über Steam oder Heroic importieren.',
  'Adding …': 'Wird hinzugefügt …',
  'Add to library': 'Zur Bibliothek hinzufügen',
  'Dismiss notification': 'Hinweis schließen',
  Installed: 'Installiert',
  'No longer installed': 'Nicht mehr installiert',
  'Your own games': 'Eigene Spiele',
  '{count} installed games · Scan in {duration}':
    '{count} installierte Spiele · Scan in {duration}',
  ' · {count} notes': ' · {count} Hinweise',
  'Launch of {title} handed over.': 'Start von {title} übergeben.',
  'File selection is available in the desktop app.':
    'Die Dateiauswahl ist in der Desktop-App verfügbar.',
  'Choose game': 'Spiel auswählen',
  'Custom covers are available in the desktop app.':
    'Eigene Cover sind in der Desktop-App verfügbar.',
  'Choose cover': 'Cover auswählen',
  'Game cover': 'Spielcover',
  'Cover saved.': 'Cover gespeichert.',
  'Game added to your library.': 'Spiel zur Bibliothek hinzugefügt.',
  'Entry removed. Game files remain untouched.':
    'Eintrag entfernt. Die Spieldateien bleiben erhalten.',
  'Settings saved.': 'Einstellungen gespeichert.',
  'Local game discovery is available in the desktop app.':
    'Die lokale Erkennung ist in der Desktop-App verfügbar.',
  'Design preview: example games are not installed.':
    'Designvorschau: Beispielspiele sind nicht installiert.',
  'You can add your own games in the desktop app.':
    'Eigene Spiele lassen sich in der Desktop-App hinzufügen.',
  'Library is locked': 'Bibliothek gesperrt',
  'Game not found': 'Spiel nicht gefunden',
  'A scan is already running': 'Ein Scan läuft bereits',
  'Unknown controller type': 'Unbekannter Controller-Typ',
  'This game is already in your library': 'Dieses Spiel ist bereits vorhanden',
  'Only manual entries can be removed': 'Nur manuelle Einträge können entfernt werden',
  'This game is no longer installed. Scan the library again.':
    'Spiel ist nicht mehr installiert. Bitte Bibliothek aktualisieren.',
  'Enter a name with 1–160 characters': 'Bitte einen Namen mit 1–160 Zeichen angeben',
  'Choose an absolute path': 'Bitte einen absoluten Pfad wählen',
  'Choose an executable file': 'Bitte eine ausführbare Datei wählen',
  'Choose an .exe file on Windows': 'Unter Windows bitte eine .exe-Datei wählen',
  'The file is not executable': 'Datei hat keine Ausführungsrechte',
  'Working directory is missing': 'Arbeitsverzeichnis fehlt',
  'Launch protocol is not allowed': 'Nicht erlaubtes Startprotokoll',
  'No store client is registered for this game':
    'Für dieses Spiel ist kein Store-Client registriert',
  'The game working directory is unavailable':
    'Das Arbeitsverzeichnis des Spiels ist nicht verfügbar',
  'The game file no longer exists': 'Spieldatei nicht mehr vorhanden',
  'This macOS app is unavailable': 'macOS-App nicht verfügbar',
  'Invalid Xbox app ID': 'Ungültige Xbox-App-ID',
  'Artwork cache is locked': 'Cover-Cache gesperrt',
  'Artwork cache identity collision': 'Cover-Cache-ID kollidiert',
  'Artwork search response is too large': 'Bildsuche-Antwort zu groß',
  'Artwork metadata is too large': 'Bildmetadaten zu groß',
  'Covers must not exceed 8 MiB': 'Cover darf höchstens 8 MiB groß sein',
  'Choose a JPEG, PNG or WebP image': 'Bitte ein JPEG-, PNG- oder WebP-Bild wählen',
  'Unknown artwork format': 'Unbekanntes Bildformat',
  'An absolute image path is required': 'Ein absoluter Bildpfad ist erforderlich',
};

/** Resolve preference `language` against ordered system `languages`; unsupported locales fall back to English. */
export function resolveLocale(language: Language, languages: readonly string[]): Locale {
  if (language === 'de' || language === 'en') return language;
  for (const candidate of languages) {
    const base = candidate.toLowerCase().split('-')[0];
    if (base === 'de' || base === 'en') return base;
  }
  return 'en';
}

/** Translate English `message` to `locale` and interpolate named `parameters` without rendering HTML. */
export function translate(
  locale: Locale,
  message: string,
  parameters: Record<string, string | number> = {},
): string {
  return (locale === 'de' ? (german[message] ?? message) : message).replace(
    /\{(\w+)\}/g,
    (match, key: string) => String(parameters[key] ?? match),
  );
}

/** Return the localized provider label for `store` in UI `locale`. */
export function storeName(store: Store, locale: Locale): string {
  return {
    steam: 'Steam',
    epic: 'Epic Games',
    gog: 'GOG',
    xbox: 'Xbox · Game Pass',
    ubisoft: 'Ubisoft Connect',
    battlenet: 'Battle.net',
    rockstar: 'Rockstar Games',
    manual: translate(locale, 'Your own games'),
  }[store];
}
