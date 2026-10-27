# Plateforme RH — Bénin

Application installable (PWA) hébergée sur GitHub Pages, avec Google Sheets comme base de données via un script Google (Apps Script).

## Contenu

- `index.html`, `config.js`, `manifest.webmanifest`, `sw.js`, `icons/` : l’application (à mettre sur GitHub).
- `backend/Code.gs` : le script à coller dans Google (ne va pas sur GitHub).

## Étape 1 — Préparer le Google Sheet

1. Ouvrez votre Google Sheet, menu **Extensions → Apps Script**.
2. Supprimez le code existant, collez tout le contenu de `backend/Code.gs`, puis enregistrez.
3. Dans la liste des fonctions, choisissez **setup** et cliquez **Exécuter**. Acceptez les autorisations (Google affiche « application non vérifiée » : **Paramètres avancés → Accéder au projet**).
4. Une fenêtre affiche les mots de passe temporaires de `admin`, `drh`, `comptable` et `demo`. **Notez-les tout de suite.**

Tous les onglets (Agents, Comptes, Regles, Demandes, Paies…) et les règles de la loi 2015-18 sont créés automatiquement.

## Étape 2 — Publier l’API

1. Dans Apps Script : **Déployer → Nouveau déploiement → type « Application Web »**.
2. *Exécuter en tant que* : **Moi**. *Qui a accès* : **Tout le monde**.
3. Copiez l’URL qui se termine par `/exec`.

## Étape 3 — GitHub

1. Ouvrez `config.js` et remplacez `COLLER_ICI_L_URL_DU_SCRIPT` par l’URL copiée.
2. Créez un dépôt GitHub et importez : `index.html`, `config.js`, `manifest.webmanifest`, `sw.js` et le dossier `icons/`.
3. **Settings → Pages → Branch : main, dossier / (root) → Save.**
4. Au bout d’une minute, le site est en ligne sur `https://VOTRE-NOM.github.io/NOM-DU-DEPOT/`.

## Étape 4 — Installer l’application

- **Android (Chrome)** : menu ⋮ → *Installer l’application*.
- **iPhone (Safari)** : Partager → *Sur l’écran d’accueil*.

## Sécurité à respecter

- Gardez le Google Sheet **privé** (partagé avec vous seul). Les agents n’y accèdent jamais directement : tout passe par l’API.
- Les mots de passe sont enregistrés hachés (SHA-256 avec sel), jamais en clair. Les comptes créés ont un mot de passe temporaire à changer à la première connexion.
- Supprimez ou modifiez le compte `demo` et l’agent `DEMO-001` avant la mise en service.
- Après toute modification de `Code.gs`, faites **Déployer → Gérer les déploiements → Modifier → Nouvelle version**.
- Google Sheets convient pour un pilote ou un petit effectif. Pour une administration entière, migrez vers la base PostgreSQL (`base_de_donnees_rh_benin.sql`) sans changer l’interface.

## Règles de congés à confirmer

- **Fonctionnaires** : conformes à la loi 2015-18 (art. 154, 159, 161, 169, 176).
- **Contractuels (ACE) et sous-contractuels** : règles copiées **provisoirement** de celles des fonctionnaires (colonne `a_verifier = OUI`). Modifiez-les dans l’onglet `Regles` dès que vous avez les textes applicables.
- **Autorisations d’absence** (autre motif) : le nombre de fois par an est à fixer dans l’onglet `Regles` (colonnes `max_fois` et `plafond_jours`).

## Paie

Le comptable ouvre un mois : une ligne est créée par agent actif (brut = salaire de base). Il peut ajuster brut et retenues, puis **valide ou suspend** chaque agent avec motif, et clôture la période. Les agents voient alors leur fiche. Le calcul détaillé (rubriques, indices) sera branché dès réception du canevas officiel.
