# longMountainPath

Nauka kolejnych punktów Głównego Szlaku Beskidzkiego (Ustroń → Wołosate).
Wpisujesz po kolei nazwy punktów: cały szlak od początku albo wybrane pasmo.

**Uruchom w przeglądarce:** https://krystianjohn88.github.io/longMountainPath/

Strona statyczna w czystym JS, bez serwera i bez zależności. Działa na GitHub Pages.

## Dane – `points.json`

Tablica punktów w kolejności szlaku (wg `id`):

```json
{ "id": 1, "name_mountain_part": "Beskid Śląski", "label": "Ustroń", "typ_punktu": "miasto" }
```

`typ_punktu`: `góra` | `przełęcz` | `schronisko` | `miasto` | `polana` | `inne`.

Przy sprawdzaniu nie liczą się polskie znaki, wielkość liter ani myślniki. Przedrostki „Przełęcz”, „Hala”, „Schronisko” można pominąć,
a nazwę z dopiskiem w nawiasie można wpisać bez nawiasu albo samym dopiskiem.

## Lokalnie

Dowolny serwer statyczny, np. `npx serve .` albo `python -m http.server`. Bezpośrednie otwarcie pliku nie zadziała, bo `fetch` nie wczyta wtedy `points.json`.
