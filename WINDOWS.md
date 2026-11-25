# Młynek POS na Windows 10/11

## Instalator

1. Pobierz [Mlynek-POS-0.2.0-Windows-x64-Setup.exe](https://github.com/mixx1k/app_gpt/releases/download/v0.2.0/Mlynek-POS-0.2.0-Windows-x64-Setup.exe) (około 156 MB). Nie trzeba logować się do GitHuba.
2. Uruchom instalator, wybierz folder i zakończ instalację. Nie wymaga konta administratora.
3. Otwórz **Młynek POS** ze skrótu na pulpicie lub z menu Start.

Program zawiera własne środowisko wykonawcze. Nie trzeba instalować Node.js, otwierać przeglądarki ani uruchamiać serwera. Menu, sprzedaż i magazyn działają bez Internetu. Instalator jest przeznaczony dla Windows 10/11 **64-bit** i nie ma jeszcze podpisu wydawcy; Windows może wyświetlić komunikat o nieznanym wydawcy. Sumy kontrolne plików znajdują się w `SHA256SUMS.txt`.

## Wersja bez instalacji

Pobierz i rozpakuj **cały** plik [Mlynek-POS-0.2.0-Windows-x64.zip](https://github.com/mixx1k/app_gpt/releases/download/v0.2.0/Mlynek-POS-0.2.0-Windows-x64.zip) do wybranego folderu i uruchom `Młynek POS.exe`. Wszystkie pliki z archiwum muszą pozostać razem. Nie uruchamiaj programu bezpośrednio z podglądu ZIP.

Wersja ZIP i zainstalowana aplikacja używają tego samego profilu danych na danym koncie Windows. Drugie uruchomienie przełącza do istniejącego okna.

## Dane i kopie zapasowe

- Zamówienia i menu są zapisywane automatycznie w `%APPDATA%\Mlynek POS\data\pos.sqlite`.
- Dane koszyka znajdują się w profilu aplikacji i zachowują się po zamknięciu okna.
- Pierwsze uruchomienie każdego dnia tworzy kopię dotychczasowej bazy w `%APPDATA%\Mlynek POS\backups\auto-RRRR-MM-DD.sqlite`.
- Aby zrobić dodatkową kopię, wybierz **Plik → Utwórz kopię zapasową…** lub naciśnij **Ctrl+Shift+B**. Plik można zapisać na innym dysku.
- **Plik → Otwórz folder danych** otwiera profil aplikacji. Nie usuwaj plików w tym folderze podczas działania POS.
- Aktualizacja i odinstalowanie programu zachowują profil danych. Codzienna kopia na tym samym dysku nie chroni przed awarią dysku — przechowuj potrzebne kopie również poza komputerem.

Jeśli masz bazę z wcześniejszej wersji przeglądarkowej, wykonaj w niej `npm run db:backup`. Zamknij obie wersje POS, zachowaj istniejący profil wersji PC i przenieś kopię jako `data\pos.sqlite` do nowego profilu. Nie nadpisuj działającej bazy ani nie mieszaj jej z plikami `-wal` / `-shm` pochodzącymi z innej bazy.

## Obsługa okna

- **F11** — pełny ekran.
- Menu **Widok** — zmiana powiększenia i odświeżenie.
- Menu **Edycja** — kopiowanie, wklejanie i cofanie zmian w polach.
- Na potwierdzeniu zamówienia przycisk **Drukuj** otwiera okno drukowania systemu.

To nadal pierwsza wersja POS: dane początkowe są demonstracyjne, brak logowania pracowników, fiskalizacji oraz połączenia z terminalem płatniczym. Płatność kartą należy najpierw przyjąć na zewnętrznym terminalu. Wydruk z programu jest dokumentem niefiskalnym.

## Budowanie ze źródeł

Ta część dotyczy programisty. Zainstalowany program nie wymaga tych poleceń.

W katalogu projektu, używając Node.js 24:

```powershell
npm ci
npm run desktop:install
npm run desktop
```

`desktop:install` pobiera przypiętą wersję Electron i sprawdza jej sumy kontrolne. `desktop` buduje interfejs i otwiera okno aplikacji. Po zmianach kodu uruchom program ponownie. Dane lokalne wersji developerskiej również trafiają do profilu; do prób można ustawić `POS_DESKTOP_USER_DATA` na osobny katalog.

Instalator i ZIP:

```powershell
npm run dist:win
```

Wyniki powstają w `release/`. Konfiguracja nie podpisuje aplikacji certyfikatem wydawcy. Testy natywnego okna:

```powershell
npm run build
npm run test:desktop
```

Workflow `.github/workflows/windows.yml` buduje program na Windows, testuje spakowaną aplikację, instalację, odinstalowanie i zachowanie dodatkowych plików użytkownika, a następnie udostępnia pliki jako artefakty. Uruchomienie workflow wymaga zapisania kodu w repozytorium GitHub; samo istnienie pliku workflow nie oznacza wykonania testów na Windows.
