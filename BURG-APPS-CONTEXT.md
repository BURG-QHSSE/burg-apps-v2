# BURG Apps v2 — Projectcontext

Dit document geeft in één keer alle context die nodig is om met dit project verder te werken — ook in Claude Code. Deel dit bestand (of plak de inhoud in een chat) en Claude Code weet meteen waar het project over gaat, zonder dat er al toegang tot GitHub hoeft te zijn.

---

## Wat is dit?

BURG Apps v2 — een React/Vite-portal voor BURG QHSSE met een rollen-systeem (admin/manager/hr/user) en alle dagelijkse tools van recruiters/consultants op één plek (fee-berekeningen, Doorgroei Tracker, Kansen Swiper, etc.). Losstaande, nieuwere opvolger van de originele `BURG-Apps`-repo (GitHub Pages).

**Live:** https://app.burgqhsse.nl
**Repo:** https://github.com/BURG-QHSSE/burg-apps-v2

---

## Hoe je aan de slag gaat

```bash
git clone https://github.com/BURG-QHSSE/burg-apps-v2.git
cd burg-apps-v2
npm install
cp .env.example .env   # vul in met de Supabase-projectgegevens hieronder
npm run dev
```

Daarna kan Claude Code gewoon gestart worden in deze map — de repo bevat een **`CLAUDE.md`** die automatisch wordt gelezen en dezelfde technische context geeft als dit document.

---

## De drie andere documenten in de repo

Dit bestand is een snelle samenvatting. Voor meer diepgang staan er in de root van de repo:

- **`ARCHITECTUUR.md`/`.pdf`** — hoe GitHub, Vercel, Supabase, EmailJS en de Google Sheet precies samenwerken, met een schema. Begin hier voor het technische plaatje.
- **`OVERDRACHT.md`/`.pdf`** — welke accounts/organisaties er zijn, wie waar toegang toe heeft, en wat is overgedragen.
- **`ONBOARDING.md`/`.pdf`** — niet-technisch overzicht van alle tools, voor een nieuwe collega.

---

## Samengevat: de belangrijkste feiten

- **Code**: GitHub-organisatie `BURG-QHSSE`, repo `burg-apps-v2`. Push naar `main` → Vercel deployt automatisch.
- **Hosting**: Vercel, gratis team "BURG QHSSE", live op `app.burgqhsse.nl`.
- **Database/auth**: Supabase-organisatie "BURG QHSSE", project-ref `kthriaekxqxijhqboxkd`. Volledige schema-documentatie staat in `supabase/schema.sql`.
- **Los, ouder Supabase-project (`burg-jobs`)**: voor "Mijn Omgeving"/Kansen Swiper — hoort bij het originele BURG-Apps-project.
- **E-mail**: EmailJS, account-adres `office@burgbedrijven.nl`.
- **Doorgroei Tracker**: leest geen Supabase, maar een Google Sheet + Apps Script, eigendom bij `office@burgbedrijven.nl`.
- **Belangrijk bij database-wijzigingen**: geen migratie-tooling — pas `supabase/schema.sql` aan én draai de SQL zelf handmatig tegen de live database (SQL-editor of `npx supabase db query --linked`).

---

Dit project is bewust zo ingericht dat het beheer niet aan één specifiek persoon hangt — alle organisaties/accounts staan op naam van BURG, niet van een individu. Bij vragen: de vier documenten hierboven zijn geschreven om zonder nadere mondelinge uitleg te kunnen worden opgepakt.
