# Provenance demo

Workspace scaffold for shared verification code, a server, and a browser client.
Source files are placeholders; application behavior and build commands still need implementation.

## Setup

1. Run `npm install` from this directory to initialize the three npm workspaces.
2. Copy `.env.example` to `.env` and fill in the demo settings.
3. Implement the shared modules, server routes, and client screens in the supplied files.

`server/keys/` and `server/data/` (including uploads) are local, gitignored directories.
Recreate them in a fresh checkout before adding keys or data.

## Demo-day checklist

- [ ] Implement and run `scripts/gen-authorities.ts` to generate demo authority keys.
- [ ] Implement and run `scripts/seed-feed.ts` to seed Mara's green, amber, and grey feed items.
- [ ] Check RP_ID and ORIGIN against the demo host.
- [ ] Verify setup, capture, feed, item, upload, and editor flows.
- [ ] Check detection provider configuration and unavailable-provider handling.
