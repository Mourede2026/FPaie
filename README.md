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

## Mise à jour (si le script est déjà installé)

1. Remplacez le code dans Apps Script par le nouveau `Code.gs`, puis enregistrez.
2. Relancez la fonction **setup** : elle ajoute les nouvelles colonnes (CNSS, grade, indice, indemnités…), les rubriques du bulletin et l’onglet `Parametres`, sans effacer vos données ni recréer les comptes.
3. **Déployer → Gérer les déploiements → crayon → Nouvelle version → Déployer** (même URL).
4. Remplacez les fichiers du site sur GitHub par ceux du dossier.

## Comptes, mots de passe et empreinte digitale

- **Mots de passe visibles** : la colonne `mot_de_passe` de l’onglet `Comptes` contient le mot de passe **actuel** de chaque utilisateur, mis à jour dès qu’il le change. L’administrateur les voit aussi dans l’onglet **Comptes** de l’application (clic sur les points pour afficher).
- **Modifier depuis le Sheet** : tapez le nouveau mot de passe (8 caractères min.) dans `mot_de_passe` : il est pris en compte immédiatement. Pour imposer un changement à la prochaine connexion, mettez `OUI` dans `doit_changer`. Pour bloquer un compte, mettez `NON` dans `actif`. Fonctionne si le script a été ouvert depuis le Sheet (Extensions → Apps Script).
- **Mots de passe déjà choisis avant cette mise à jour** : ils n’ont pas été conservés, donc ils ne peuvent pas être affichés. Ils apparaîtront dès que l’agent le change, ou que vous en définissez un.
- **Depuis l’application** : l’administrateur peut définir, générer, modifier, désactiver ou supprimer un compte.
- **Empreinte digitale** : l’agent l’active dans « Mon compte ». Elle ne fonctionne qu’en HTTPS et si l’appareil a une empreinte ou un verrouillage d’écran. Un nouveau mot de passe défini par l’administrateur retire l’empreinte des appareils du compte.
- **Protection du Sheet** : comme les mots de passe y sont lisibles, ne partagez ce Google Sheet avec personne d’autre que vous.

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

Le bulletin reprend le modèle officiel du Ministère de la Santé (Bulletin de paie, septembre 2025) : en-tête, identité, N° CNSS, grade, indice, corps, service, tableau Code / Élément payé / Gain / Retenue / Rappel, banque et compte, net à payer et montant en lettres.

Calcul (onglet `Parametres`, modifiable) :
- Net = gains − ITS − part ouvrière CNSS − ORTB + rappel.
- Part ouvrière CNSS 3,6 % et part patronale 16,4 % du brut (déduits du bulletin modèle). La part patronale est affichée en « Retenue » mais n’est pas déduite du net.
- ITS : barème progressif de l’onglet `Parametres` (`bareme_its`), arrondi à 100 F. **À faire confirmer par la DGI**, et le comptable peut saisir l’ITS à la main.

Le comptable ouvre un mois : une ligne est créée par agent actif à partir de sa fiche. Il ajuste si besoin, puis **valide ou suspend** chaque agent avec motif et clôture la période. Les agents voient alors leur bulletin et l’impriment en PDF.
