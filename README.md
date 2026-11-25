# Młynek POS

POS dla kawiarni w wersji desktopowej na **Windows 10/11 64-bit**: menu, koszyk, sprzedaż, magazyn gotowych produktów i historia zamówień. Interfejs po polsku, ceny w PLN, dzień sprzedaży według strefy `Europe/Warsaw`.

## Aplikacja na PC

**[Pobierz instalator Windows 10/11 (.exe, około 156 MB)](https://github.com/mixx1k/app_gpt/releases/download/v0.2.0/Mlynek-POS-0.2.0-Windows-x64-Setup.exe)** — pobranie nie wymaga logowania do GitHuba. Dostępna jest też [wersja ZIP bez instalacji](https://github.com/mixx1k/app_gpt/releases/download/v0.2.0/Mlynek-POS-0.2.0-Windows-x64.zip). To wersja demonstracyjna 0.2.0.

Zainstalowany program działa we własnym oknie, ma własne środowisko Electron i bazę SQLite. Nie wymaga Node.js, przeglądarki, ręcznego uruchamiania serwera ani połączenia z Internetem. Szczegóły instalacji, danych i kopii: [WINDOWS.md](WINDOWS.md). Pliki z lokalnego budowania powstają w `release/`.

Uruchomienie desktopu ze źródeł (Node.js 24):

```sh
npm ci
npm run desktop:install
npm run desktop
```

`npm run dist:win` buduje instalator i archiwum ZIP. Dane użytkownika są przechowywane w profilu systemowym aplikacji, oddzielnie od plików programu. Menu **Plik** udostępnia kopię zapasową i folder danych. Działa jedna instancja programu na profil.

Wersja desktopowa otwiera interfejs pod stałym wewnętrznym adresem `mlynek://app`, więc koszyk i identyfikatory ponawianych płatności przetrwają restart. API startuje automatycznie na losowym porcie lokalnym, chronionym tokenem procesu. Renderer ma włączoną izolację i sandbox, bez dostępu do Node.js i bez otwierania zewnętrznych stron. Nie ma publicznego serwera.

## Tryb przeglądarkowy dla programisty

Wymagane: **Node.js 24.x** i npm. W środowisku chmurowym projekt znajduje się w `/workspace/app_gpt`.

```sh
cd /workspace/app_gpt
npm ci --cache /workspace/.cache/npm
npm run dev
```

`npm run dev` uruchamia Vite na porcie **5173** oraz API na porcie **3001**, oba na interfejsie lokalnym `127.0.0.1`. Zatrzymanie polecenia zatrzymuje oba procesy. Zmiany interfejsu i backendu przeładowują się automatycznie.

Wariant z gotowym frontendem, obsługiwanym przez jeden proces:

```sh
npm run build
npm start
```

Frontend i API są wtedy dostępne na porcie **3001**. Nie uruchamiaj jednocześnie `npm start` i `npm run dev` na tym samym porcie. Stan API można sprawdzić lokalnie:

```sh
curl --fail http://127.0.0.1:3001/api/health
```

Na własnym komputerze wystarczy `npm ci` bez parametru `--cache`. Aplikacja nie wymaga zewnętrznych kluczy ani usług. Pierwszy start tworzy `data/pos.sqlite` i przykładowe menu; kolejne starty zachowują dane. Katalog `data/` jest wyłączony z Git.

## Co działa

- Menu 15 przykładowych produktów, filtrowanie kategorii i wyszukiwanie.
- Koszyk z ilościami, rabatem procentowym i uwagami.
- Obsługa na miejscu, wybór stolika 1–12 lub zamówienie na wynos.
- Rozliczenie gotówki z wyliczeniem reszty; zapis płatności wykonanej na zewnętrznym terminalu.
- Potwierdzenie sprzedaży z pozycjami, VAT, rabatem i wydrukiem przez przeglądarkę. Dokument jest **niefiskalny**.
- Dzienne podsumowanie sprzedaży i ostatnie 100 zamówień.
- Dodawanie i edycja produktów, przyjęcia oraz rozchody magazynowe z historią zmian.
- Anulowanie całej sprzedaży: rachunek pozostaje w historii, produkty wracają do magazynu, dzienne podsumowanie jest korygowane. Zwrot pieniędzy odbywa się osobno.
- Zapis pozycji koszyka w przeglądarce; ponowienie płatności po utracie odpowiedzi bez duplikowania sprzedaży.
- Spójna kopia bazy SQLite, także podczas działania serwera.

Przykładowe ceny, stany i VAT służą demonstracji. Przed użyciem własnego menu należy dobrać prawidłowe stawki VAT. W tej wersji stawka jest przypisana do produktu i nie zmienia się automatycznie między sprzedażą na miejscu a na wynos.

## Architektura

```text
React + TypeScript (przeglądarka)
              │ JSON /api
              ▼
Express + Zod (Node.js 24)
              │ transakcje
              ▼
SQLite: produkty, sprzedaż, pozycje rachunków, ruchy magazynowe
```

- `src/` — aplikacja kasjera, magazyn, historia i formularze.
- `desktop/` — natywne okno, menu systemowe, profil danych, zabezpieczenie dostępu do API i kopie zapasowe.
- `electron-builder.yml` — konfiguracja instalatora Windows i pakowania aplikacji.
- `build/installer.nsi` — instalator NSIS dla bieżącego użytkownika, z deinstalatorem usuwającym wyłącznie pliki programu. `scripts/installer-files.mjs` generuje ich listę podczas pakowania; kompilacja instalatora nie wymaga Wine.
- `server/app.mjs` — API HTTP i walidacja danych.
- `server/sales.mjs` — rozliczenia, idempotencja i anulowanie sprzedaży.
- `server/db.mjs` — schemat bazy oraz jednorazowe dane demonstracyjne.
- `scripts/` — uruchomienie developerskie i kopia bazy.
- `tests/` — testy API, bazy i obsługi w przeglądarce.

SQLite pozwala uruchomić pierwsze stanowisko bez osobnego serwera bazy. Rozbudowa o PostgreSQL, wielu pracowników i wiele stanowisk będzie osobnym etapem.

Kwoty są przechowywane jako całkowite grosze. Backend ustala ceny na podstawie menu i odrzuca koszyk ze zmienionymi cenami. Rabat jest dzielony pomiędzy pozycje z zachowaniem sumy co do grosza, a VAT obliczany z kwot brutto po rabacie. Sprzedaż, jej pozycje, zmniejszenie stanu i wpisy magazynowe powstają w jednej transakcji. Identyfikator żądania płatności jest unikalny; ponowienie tego samego żądania zwraca istniejący rachunek.

Niepotwierdzone żądanie płatności pozostaje w przeglądarce z tym samym identyfikatorem. Po błędzie połączenia należy użyć **Ponów potwierdzenie**. Nie czyść danych przeglądarki przed wyjaśnieniem wyniku tej operacji.

## Testy

```sh
npm run check
npm run test:e2e
npm run test:desktop
```

`check` wykonuje sprawdzanie TypeScript, kompilację oraz testy API i bazy. Testy przeglądarkowe wymagają wcześniejszej kompilacji, automatycznie uruchamiają aplikację na porcie 3101 i tworzą odrębną bazę w katalogu tymczasowym. Nie zmieniają bazy używanej przez `npm start` lub `npm run dev`.

W środowisku chmurowym Playwright używa istniejącego `/usr/bin/chromium`. Na innym komputerze można wskazać `CHROMIUM_PATH` albo pobrać przeglądarkę poleceniem `npx playwright install chromium`.

Testy obejmują rozliczenia i zaokrąglenia, brak stanu magazynowego, nieaktualne ceny, równoczesne żądania, anulowanie, trwałość bazy, pełną sprzedaż przez interfejs, uzupełnianie magazynu, utraconą odpowiedź płatności i układ mobilny.

Testy desktopu uruchamiają rzeczywisty Electron z osobnym, tymczasowym profilem. Sprawdzają okno, ochronę renderera, menu systemowe, kopię przy starcie oraz zachowanie sprzedaży i koszyka po ponownym uruchomieniu. W bezekranowym środowisku Linux użyj `CI=1 XDG_CACHE_HOME=/workspace/.cache npm run test:desktop`. Zmienna `POS_PACKAGED_APP` pozwala wskazać plik wykonywalny zbudowanej paczki zamiast źródeł.

W chmurze pobieranie Electron wymaga zapisywalnego cache: `electron_config_cache=/workspace/.cache/electron ELECTRON_GET_USE_PROXY=1 npm run desktop:install`. Przy pakowaniu ustaw `XDG_CACHE_HOME=/workspace/.cache` i `ELECTRON_BUILDER_CACHE=/workspace/.cache/electron-builder`. Pobranie zależności wymaga `registry.npmjs.org`, a runtime i narzędzia pakowania pochodzą z wydań GitHub. Weryfikacja TLS i sum kontrolnych pozostaje włączona.

## Dane i kopie zapasowe

Opcjonalne zmienne procesu:

| Zmienna         | Domyślnie                                      | Znaczenie                                                       |
| --------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| `POS_DB_PATH`   | `data/pos.sqlite`                              | Ścieżka do bazy; ścieżki względne liczone od katalogu projektu  |
| `PORT`          | `3001`                                         | Port API i wersji zbudowanej; proxy developerskie oczekuje 3001 |
| `CHROMIUM_PATH` | systemowy Chromium lub przeglądarka Playwright | Przeglądarka do testów                                          |

```sh
npm run db:backup
# Lub z nową, wybraną ścieżką:
npm run db:backup -- /workspace/pos-backups/kopia.sqlite
```

Skrypt używa mechanizmu kopii SQLite, więc uwzględnia również dane z dziennika WAL. Nie nadpisuje istniejących plików. Kopie domyślnie trafiają do `data/backups/`; przenieś potrzebne kopie poza maszynę, jeśli chcesz chronić dane przed jej utratą.

Aby odtworzyć kopię, zatrzymaj procesy POS, zachowaj aktualną bazę wraz z ewentualnymi plikami `-wal` i `-shm`, a następnie wskaż kopię przez `POS_DB_PATH` lub odtwórz ją pod nową ścieżką. Nie podmieniaj samego pliku bazy podczas pracy aplikacji.

## Zakres pierwszej wersji

To lokalny prototyp do rozwoju i demonstracji, bez logowania i ról pracowników. Tryb desktopowy obsługuje dane na komputerze bez Internetu. Opcjonalny serwer developerski nasłuchuje tylko na `127.0.0.1`; nie należy udostępniać go publicznie przez proxy bez dodania uwierzytelniania i kontroli uprawnień.

Magazyn liczy gotowe produkty i porcje, nie składniki receptur. Numer stolika jest opisem zamówienia, bez otwartych rachunków i łączenia stolików. Uwagi zapisują się na rachunku; nie ma jeszcze kolejki kuchennej. Nie ma synchronizacji między komputerami, integracji fiskalnej, bezpośredniej obsługi terminala, częściowych zwrotów ani ewidencji zmian kasjera. Koszyk zachowuje pozycje po odświeżeniu i restarcie; przed płatnością trzeba ponownie ustawić stolik, uwagi i rabat.

Kolejne etapy dla gastronomii: otwarte rachunki stolików, kolejka bar/kuchnia, modyfikatory napojów, receptury i surowce, logowanie z rolami, integracja terminala oraz drukarki fiskalnej.

## Formatowanie

```sh
npm run format
npm run format:check
```
