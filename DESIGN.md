---
version: alpha
name: "ShinobiCraft2 Launcher"
description: "Desktop launcher with Naruto artwork and compact account controls."
colors:
  text: "#ffffff"
  loginSurface: "rgba(0, 0, 0, 0.50)"
  controlSurface: "rgba(0, 0, 0, 0.25)"
  controlBorder: "rgba(126, 126, 126, 0.57)"
  offlineError: "#ffb7b7"
typography:
  body:
    fontFamily: "Avenir Book, sans-serif"
  heading:
    fontFamily: "Avenir Medium, sans-serif"
rounded:
  control: "3px"
spacing:
  loginActionGap: "10px"
  offlineFieldGap: "8px"
components:
  loginAction:
    height: "50px"
    width: "16em"
---

# ShinobiCraft2 Launcher

## Overview

The existing Naruto artwork carries the launcher identity. Account controls stay compact and readable over dark translucent surfaces. This feature extends the existing Helios login workflow without changing the artwork or screen architecture. The requested offline login serves players using a local nickname. New offline labels use Portuguese through the existing custom TOML layer, with English fallback in en_US.toml.

Runtime ownership: app/assets/css/launcher.css is the canonical source of visual values; this document records the login controls implemented there. No token generator or additional UI framework is introduced.

## Colors

White text sits on dark translucent controls with gray borders. Offline field errors use pale red plus explanatory text. Focus uses a visible white outline; meaning never relies on color alone.

## Typography

Retain the bundled Avenir font families. Offline inputs inherit the surrounding form typography; help and error text use the existing compact utility treatment.

## Layout

The login options use a centered vertical stack, with 16em controls. The offline form follows the provider actions and remains constrained to the available viewport width. Error space is reserved to avoid shifting the submit action.

## Elevation & Depth

Use the existing translucent surfaces and borders. Artwork provides depth; account forms do not introduce additional cards or ornamental shadows.

## Shapes

Keep the existing 3px corner radius for login controls.

## Components

Canonical form owner: loginOptions.ejs and scripts/loginOptions.js. Profile validation is repeated at the AuthManager boundary. The selected profile is saved through ConfigManager and shown through updateSelectedAccount. Navigation uses switchView and preserves the existing landing/settings success destinations.

Reuse loginOptionButton for the offline action. Native labels and inputs own keyboard behavior. Validation errors are associated with the input and announced through an alert region. Submitting disables competing actions, reserves button geometry, and shows a waiting label. Errors preserve the nickname and restore input focus. Offline profiles skip online token validation and online logout requests.

Existing account selection and logout remain owned by scripts/settings.js. Offline accounts appear in the existing non-Microsoft group with an Offline marker. Text translations remain owned by langloader.js and the TOML files.

The offline control respects reduced motion. Keep existing provider icons and named buttons. No popup, new modal, select, table, or toast system is needed for this feature.

## Do's and Don'ts

- Keep the existing login controls and navigation destinations.
- Explain invalid nicknames next to the field and allow retry.
- Preserve nickname capitalization because it determines the offline UUID.
- Do not route local profiles through Microsoft or Mojang token renewal.
