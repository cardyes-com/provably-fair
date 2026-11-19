# Cardyes Provably Fair Validator

Verify Cardyes Infinite rolls and Booster Pack slot rarities in your browser.
Paste the proof into the matching tab and run verification locally.

No login, server, PHP runtime, or network request is required.

## How to use

1. Open `index.html` in a browser and select **Infinite** or **Booster Pack**.
2. Copy the roll proof JSON from Cardyes, including the `{ }`.
3. Paste it into the input box and click **Check**.
4. Green messages mean the public hash and roll match.

## Infinite

This page verifies the current `infinite` roll proof copied from Cardyes:

- `client_seed`
- `server_seed`
- `public_hash`
- `nonce`
- `roll`

The validator checks:

```text
sha256(server_seed) === public_hash
roll === HMAC_SHA256(server_seed, client_seed + ":" + nonce) % 100000000
```

The roll calculation uses the first 8 bytes of the HMAC digest as a big-endian
uint64 and applies rejection sampling before modulo reduction.

## Run it yourself

Open the file directly:

```text
index.html
```

Or host the folder on any static file server, GitHub Pages, Cloudflare Pages,
Replit, or similar static hosting service.

## Sample data

```json
{
  "client_seed": "92465d3b1825a2b433a2c7a8e934b7b2",
  "server_seed": "8f163f6bba3f2bcc78adb62aa89d8b7f1946e53ba1badc212bdaedcade0f3d1f",
  "public_hash": "03af7d1789f7bb7fec6c342e9338ac383f8d63f846c1a80aa087b3eff64f7c42",
  "nonce": 0,
  "roll": 81911906
}
```

## Booster Pack

Open `#booster` and paste a single pack proof or import an order export
using the `cardyes-booster-rarity-v1` schema. The verifier hashes the exact
`rulesJson` string and recalculates the roll and rarity of each slot using
`hmac-sha256-booster-rarity-v1`. A proof without the revealed seed shows
**Awaiting server seed reveal**. With a pre-purchase record, the verifier
also checks the original rules hash, seed commitment and slot nonces.
The result describes slot rarity verification. Card numbers and variants
are assigned separately.

Run the Booster Pack verifier tests with `node --test tests/booster.test.cjs`.

## Source

[github.com/cardyes-com/provably-fair](https://github.com/cardyes-com/provably-fair)
