# Cardyes Provably Fair Validator

Independently verify that your Cardyes infinite-v2 roll was provably fair. Paste
the roll data into the page and the validator recalculates the public hash and
roll locally in your browser.

No login, server, PHP runtime, or network request is required.

## How to use

1. Open `index.html` in a browser.
2. Copy the roll proof JSON from Cardyes, including the `{ }`.
3. Paste it into the input box and click **Check**.
4. Green messages mean the public hash and roll match.

## What this verifies

This page verifies the current `infinite-v2` roll proof copied from Cardyes:

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
fairness-validator/index.html
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

## Notes

This validator only verifies the copied `infinite-v2` roll proof. It does
not verify card pool selection, picked positions, or drawn card metadata because
those fields are not included in the input format.

## Source

[github.com/cardyes-com/provably-fair](https://github.com/cardyes-com/provably-fair)
