# Audigue

Extension Chrome qui lit à voix haute le contenu des pages web en français ou en anglais, en utilisant la synthèse vocale locale du navigateur.

## Fonctionnalités

- **Lecture locale** — Utilise l'API Web Speech intégrée à Chrome, aucune donnée envoyée à un serveur externe
- **Détection automatique de la langue** — Français et anglais, via l'attribut `<html lang>` ou par analyse heuristique du contenu
- **Contrôle de la vitesse** — Réglable de 0.5x à 3x en temps réel pendant la lecture
- **Extraction intelligente** — Cible le contenu principal (`<main>`, `<article>`), ignore la navigation, les scripts et les éléments cachés
- **Lecture par blocs** — Découpe le texte en segments pour gérer les pages longues

## Installation

1. Cloner ce dépôt ou télécharger le ZIP
   ```bash
   git clone https://github.com/Yanndd1/Audigue.git
   ```
2. Ouvrir Chrome et aller sur `chrome://extensions/`
3. Activer le **Mode développeur** (en haut à droite)
4. Cliquer sur **Charger l'extension non empaquetée**
5. Sélectionner le dossier `Audigue`

## Utilisation

1. Naviguer vers une page web en français ou en anglais
2. Cliquer sur l'icône Audigue dans la barre d'extensions
3. Ajuster la vitesse de lecture si besoin
4. Cliquer sur **Lire** pour démarrer la lecture audio
5. Utiliser **Pause** pour suspendre/reprendre et **Stop** pour arrêter

## Structure du projet

```
Audigue/
├── manifest.json        # Configuration de l'extension (Manifest V3)
├── background.js        # Service worker
├── content.js           # Script de contenu : extraction du texte et TTS
├── popup/
│   ├── popup.html       # Interface utilisateur du popup
│   ├── popup.css        # Styles (thème sombre)
│   └── popup.js         # Logique du popup (contrôles, communication)
├── icons/
│   ├── icon16.png       # Icône 16×16
│   ├── icon48.png       # Icône 48×48
│   └── icon128.png      # Icône 128×128
├── LICENSE              # Licence MIT
└── README.md            # Ce fichier
```

## Permissions utilisées

| Permission   | Raison                                              |
|-------------|------------------------------------------------------|
| `activeTab`  | Accéder au contenu de l'onglet actif lors du clic   |
| `scripting`  | Injecter le script de contenu dans la page          |
| `storage`    | Sauvegarder les préférences de vitesse              |

## Compatibilité

- Chrome 88+ (Manifest V3)
- Chromium, Edge, Brave et autres navigateurs basés sur Chromium

## Licence

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.
