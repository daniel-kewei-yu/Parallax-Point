# Parallax-Point

A multiplayer first-person sandbox game built with Three.js and Cannon.es.  
Pick up and throw blocks, equip a portal gun, place portals, and interact with other players in a shared physics world.

## Features

- Real-time multiplayer via SharedWorker physics simulation.
- First-person movement with jumping and mouse look.
- Two grab mechanics: forced perspective (E) and rigid rod (Q when portal gun equipped).
- Equipable portal gun with left/right click to place blue/orange portals.
- Portals are per-player, two-way, and preserve orientation and velocity.
- Animated player models (walk, idle, jump) with separated upper/lower body.
- Crosshair changes colour when hovering over grabbable objects.
- Dynamic world with platforms, pillars, and ring walls.

## How to Run

1. **Clone the repository**  
   `git clone (link will go here)`  
   `cd parallax-point`

1. **Clone the repository**  
   `git clone (link goes here)`  
   `cd parallax-point`

2. **Start a local web server**  
   The game requires a server to load assets correctly. Choose one method:

   - **Python 3** (built-in):  
     `python -m http.server 8000`

   - **Node.js** (with `npx`):  
     `npx serve .`

   - **VS Code** (with Live Server extension):  
     - Install the "Live Server" extension by Ritwick Dey.  
     - Right-click `index.html` in the Explorer panel.  
     - Select "Open with Live Server".  
     - The game will open in your default browser at a local address (e.g., `http://127.0.0.1:5500`).

   - **Any other static server** (e.g., Apache, Nginx, or `http-server`).

3. **Open your browser**  
   Navigate to the provided local address (e.g., `http://localhost:8000` or the Live Server URL).  
   Click the canvas to lock the pointer and start playing.

## Controls

| Key / Action        | Effect                                      |
|---------------------|---------------------------------------------|
| `WASD`              | Move                                        |
| `Space`             | Jump                                        |
| `E`                 | Grab / drop object (forced perspective)     |
| `Q` (portal gun equipped) | Grab / drop object (rigid rod)        |
| `F`                 | Equip / unequip portal gun                  |
| Left click          | Place blue portal (when gun equipped)       |
| Right click         | Place orange portal (when gun equipped)     |
| Mouse               | Look around                                 |

## Development

- **Lint**: Checks code for style and potential errors using ESLint. Run `npm run lint`.
- **Format**: Automatically reformats code using Prettier. Run `npm run format`.
- **Run tests**: Executes unit and integration tests with Vitest. Run `npm test`.

## Future Improvements

- Add fully functional portals (only teleports and updates relative orientation).
- Add more block types (e.g., dynamic shapes).
- Add sound effects and music.
- Create a settings menu (mouse sensitivity, volume).

---

## Credits

- **Three.js** – 3D rendering
- **Cannon.es** – Physics engine
- **GLB Models**: X Bot (Mixamo, Adobe) – converted to GLB and combined with animations (Idle, Crouched Walking, Jump, Pull Out) also sourced from Mixamo. The final model is a custom asset created by the author.
- **Superliminal/Museum of Simulation Technology Demo** – Inspiration for the forced‑perspective grab mechanic.
- **Portal 2 and Garry's Mod** – Inspiration for portal gun mechanics, player orientation preservation, and multiplayer sandbox

---

## License

McMaster © Daniel Kewei Yu
