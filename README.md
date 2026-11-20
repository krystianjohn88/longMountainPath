# longMountainPath – Szlaki długodystansowe Beskidów

Nauka kolejnych punktów szlaków górskich: wpisujesz po kolei nazwy punktów – cały szlak albo wybrany region,
w obu kierunkach.

- **GSB** – Główny Szlak Beskidzki (Ustroń ↔ Wołosate)
- **MSB** – Mały Szlak Beskidzki (Bielsko-Biała ↔ Luboń Wielki)
- **NSK** – Niebieski Szlak Karpacki (Grybów ↔ Rzeszów)

**Uruchom w przeglądarce:** https://krystianjohn88.github.io/longMountainPath/

Strona statyczna w czystym JS, bez serwera i bez zależności. Działa na GitHub Pages.

## Dane – `data/`

- `trails.json` – lista szlaków: `id`, `name`, `short`, `color` (kolor znakowania), `file`
- `gsb.json`, `msb.json`, `nsk.json` – punkty szlaku w kolejności (wg `id`):

```json
{ "id": 1, "name_mountain_part": "Beskid Niski", "label": "Chełm", "typ_punktu": "góra", "height": 778 }
```

`typ_punktu`: `góra` | `przełęcz` | `schronisko` | `miasto` | `polana` | `inne`.
`height` (m n.p.m.) jest opcjonalne – pokazuje się w podpowiedzi.

Nowy szlak = nowy plik z punktami + wpis w `trails.json`. Kierunek „od–do” bierze się z pierwszego i ostatniego punktu.

## Sprawdzanie odpowiedzi

Nie liczą się polskie znaki, wielkość liter ani myślniki. Przedrostki „Przełęcz”, „Hala”, „Schronisko PTTK”,
„Stacja Turystyczna” można pominąć, a nazwę z dopiskiem w nawiasie można wpisać bez nawiasu albo samym dopiskiem.

**Zgodność odpowiedzi:** aplikacja liczy, w ilu procentach wpisana nazwa zgadza się z poprawną (odległość Levenshteina)
i pokazuje ten wynik. Odpowiedź jest zaliczana od 80% – próg można zmienić suwakiem na ekranie startowym
(50–100%, zapamiętywany w przeglądarce).

## Lokalnie

Dowolny serwer statyczny, np. `npx serve .`. Bezpośrednie otwarcie pliku nie zadziała, bo `fetch` nie wczyta wtedy danych.


Po każdej zmianie `app.js` lub `styles.css` podbij numer `?v=` w `index.html` – inaczej przeglądarka może przez kilka minut łączyć nową stronę ze starym skryptem z pamięci podręcznej.
