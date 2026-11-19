# Experimentation revenue calculator

Calculateur de résultats de tests A/B et de projections de chiffre d’affaires, avec synchronisation Google Sheets, connexion Google OAuth, KPI du parcours, galeries d’images et de GIF, filtres et exports PDF.

Export du 19 novembre 2026, basé sur la version 24 du site et le commit `035aa8b12b3acc1af76698a043a617f7d127fbf5`.

## Fichiers

- `dist/` contient les 17 fichiers du site, dont `index.html`, les scripts JavaScript, les styles, le favicon et le modèle Excel `modele-config-ab.xlsx`.
- `.github/workflows/pages.yml` publie le dossier `dist/` sur GitHub Pages lorsque Pages est configuré avec GitHub Actions.
- `.openai/hosting.json` conserve la configuration de l’hébergement Sites d’origine.
- `.gitignore` définit les fichiers locaux à ignorer.

Le site utilise du HTML, du CSS et du JavaScript standards. Il se lance directement avec un serveur statique, sans compilation ni installation npm.

## Mettre le projet sur GitHub

1. Décompresser l’archive.
2. Créer un dépôt GitHub vide et ouvrir un terminal dans le dossier `experimentation-revenue-calculator` extrait.
3. Exécuter les commandes suivantes en remplaçant `URL_DU_DEPOT` par l’URL du dépôt.

```sh
git init
git add .
git commit -m "Import du calculateur de tests A/B"
git branch -M main
git remote add origin URL_DU_DEPOT
git push -u origin main
```

Pour passer par l’interface web GitHub, ajouter le contenu du dossier extrait au dépôt. Conserver les dossiers cachés `.github` et `.openai`.

## Héberger avec GitHub Pages

1. Dans le dépôt, ouvrir **Settings > Pages**.
2. Dans **Build and deployment > Source**, choisir **GitHub Actions**.
3. Ouvrir **Actions > Publish GitHub Pages** et lancer **Run workflow** sur la branche `main`. Les prochains changements poussés sur `main` relanceront ce déploiement.
4. Récupérer l’adresse publiée dans l’exécution du workflow ou dans **Settings > Pages**.

Le workflow publie uniquement le dossier `dist/` et utilise les permissions GitHub Pages du dépôt.

[Documentation GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Lancer sur son ordinateur

Depuis le dossier du projet, avec Python 3 installé.

```sh
python3 -m http.server 8000 --directory dist
```

Ouvrir ensuite `http://localhost:8000/` dans un navigateur.

## Connexion Google et changement d’adresse

Les deux constantes de configuration se trouvent au début de `dist/shared-tests.js`.

- `CLIENT_ID` contient l’identifiant OAuth public du projet Google Cloud déjà configuré.
- `DEFAULT_SHEET_ID` pointe vers le Google Sheet utilisé actuellement par le calculateur.

Les utilisateurs peuvent sélectionner un autre Google Sheet depuis l’onglet **Configuration**. Le CA, les informations de marque et les tests enregistrés restent dans le classeur sélectionné. Le calculateur lit le CA journalier dans les colonnes A et B de sa première feuille, la configuration de marque dans E2 à E6, puis une feuille dédiée par test.

Pour conserver la connexion Google sur GitHub Pages, ajouter la nouvelle origine aux **Origines JavaScript autorisées** du client OAuth dans Google Cloud. Pour une adresse `https://compte.github.io/nom-du-depot/`, l’origine est `https://compte.github.io`, sans le chemin du dépôt. Pour le serveur local ci-dessus, autoriser `http://localhost` et `http://localhost:8000`.

Si un autre projet Google Cloud est utilisé, activer l’API Google Sheets, configurer un client OAuth de type application Web et remplacer `CLIENT_ID` par celui de ce projet. L’accès en écriture dépend des droits du compte Google connecté sur le classeur.

Le navigateur charge Google Identity Services pour l’authentification et jsPDF 2.5.1 depuis cdnjs pour les exports PDF. Les aperçus utilisent les liens d’images et de GIF enregistrés avec les tests.

[Documentation du client OAuth Google](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid).
