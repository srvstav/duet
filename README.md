# duet

A quiet 3D world for two people. Five landscapes, five pieces of music, one sky.

| | World | Music | Meeting place |
|---|---|---|---|
| I | Dawn Meadow | Bach, Prelude in C major | the great oak: petals rise and flowers spread |
| II | Lantern Lake | Pachelbel, Canon in D | the old pier: lanterns lift off the whole lake |
| III | Moon Garden | Debussy, Clair de lune | the moon gate: the gate fills with light and the stars brighten |
| IV | Snow Waltz | Tchaikovsky, Pas de deux | the ring on the ice: the aurora flares |
| V | Above the Clouds | Bach, Air | the highest island: a burst of sunrise |

## What ties it together

- **Closeness.** The music, the colour and the thread between you all follow how far apart you are. Apart, the music sounds as if it's in another room, the world goes a little grey, and the thread is faint. Side by side, everything opens up.
- **The thread.** It always joins your two lights. Hold hands (both press **H**) and it blazes, you pull gently toward each other, and flowers grow where you pass.
- **The meeting place.** Each world has one, marked by a soft column of light. Reach it together and the world answers for both of you at the same moment.
- **The journey.** The pieces play in order, and when one ends you both travel to the next world. The line under the world's name fills as the piece plays.

## Run

```sh
npm install
npm start            # http://localhost:8080   (PORT=… to change)
```

Open a world and send the invite link. To reach someone outside your Wi-Fi, use a tunnel. Voice needs https, and the tunnel gives you that:

```sh
brew install cloudflared
cloudflared tunnel --url http://localhost:8080
```

On a slower machine, add `&q=low` to the URL for less grass and fewer trees.

### Host it on Cloudflare

The same app runs as a Cloudflare Worker. The files are served as Worker assets, and each room is a Durable Object with WebSocket hibernation, so an empty room costs nothing.

```sh
npx wrangler login   # once
npm run deploy       # → https://duet.<your-subdomain>.workers.dev
npm run dev:cf       # the same thing, locally
```

`protocol.js` holds the message rules both servers share.

## Together

- **drag** to look · **WASD** to drift · **space / shift** to rise and sink · **Q/E** to turn · **scroll** to zoom
- **H** hold hands · **F** glide to them · **enter** to talk · **V** voice, which comes from where their light is
- **1–6** heart · spark · hello · bloom · wish (a falling star) · come here (a pillar of light)

## How it's built

- `server.js` (local) and `worker/index.js` (Cloudflare): Node + `ws`, or a Durable Object per room. Rooms hold at most two people. It rebuilds every relayed message from known fields, rate-limits each socket and stores nothing. World changes and meeting moments go to both people, so both hear and see them at the same instant.
- `public/world.js`: three.js. Seeded terrain textured with photographed ground (blended by slope, height and noise), GPU grass that bends in the wind and parts around you, ez-tree trees, reflective water, a sky with clouds, stars, the Milky Way and an aurora, a sea of clouds, bloom, and a light colour grade.
- `public/music.js`: plays the recordings against a shared server clock. The Pas de deux is played live from a score on sampled harp, cello and violin. Closeness controls a filter and the volume.
- `public/net.js`: a reconnecting socket, clock sync, and WebRTC voice using perfect negotiation.

## Credits: standing on shoulders

Music
- Bach, Prelude in C: **Kimiko Ishizaka**, *Open Well-Tempered Clavier* (CC0), via Wikimedia Commons
- Pachelbel, Canon in D: **Kevin MacLeod** (incompetech.com), CC BY 3.0, via Wikimedia Commons
- Debussy, Clair de lune: **Laurens Goedhart**, piano (public domain), via Wikimedia Commons
- Bach, Air: **The Air Force Strings, U.S. Air Force Band** (public domain, U.S. government work), via Wikimedia Commons
- Tchaikovsky, Pas de deux: I couldn't find a free recording, so it's my own arrangement, played on samples from [nbrosowsky/tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) (CC BY 3.0)

Visuals
- [three.js](https://threejs.org): its Water and UnrealBloom passes, and the water normal map from its examples
- [ez-tree](https://github.com/dgreenheck/ez-tree) by Daniel Greenheck (MIT): every tree
- [Poly Haven](https://polyhaven.com) ground textures (CC0): Aerial Grass Rock, Rocky Terrain 02, Aerial Beach 01, Snow 02
- [React Bits](https://reactbits.dev): the lobby's BlurText, ShinyText and ClickSpark effects are vanilla ports of its ideas
- Simplex noise after Stefan Gustavson, and perfect negotiation from MDN
- Typefaces: Fraunces (Undercase Type) and DM Mono (Colophon)
