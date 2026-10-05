# Snapback

Snapback helps developers recover after interruptions. When a phone call pulls you away, the Android app tells your laptop to save your place: open file, cursor and unsaved edits. When you return, a resume card appears on both devices, and one tap reopens your exact spot in VS Code. It all stays on your devices, with no cloud.

**Live demo:** https://snapback-one.vercel.app/

## What this repo is

A single-page **simulation** of the full system. The real product is a laptop daemon, a VS Code extension and an Android app; none of those can run on a web host, so this page plays both devices:

- **Laptop:** a small code editor with a file tree, a cursor indicator and unsaved-edit markers.
- **Phone:** an incoming call you can answer, decline and end.
- When the call ends, a resume card appears on both. **Resume** restores the file, line, column and unsaved text from just before the phone rang.
- Calls under 5 seconds, and missed or declined calls, show no card.

The card text comes from simple rules (nearest `FIXME`/`TODO`, enclosing function, unsaved lines). The AI summary is planned for Phase 6. Nothing is stored or sent anywhere.

## Run it

```
npm install
npm run dev
```

`npm run build` type-checks and builds to `dist/`. Built with Vite, React, TypeScript and Tailwind. The logic lives in `src/snapback.ts` and the UI in `src/App.tsx`.
