# BlockHost V6.0

AI-assisted payment proof verification layered on top of V5.9.

## Important
- Midtrans/payment-gateway webhooks remain the authoritative source for gateway payments.
- AI reads uploaded proof and produces a recommendation; a screenshot alone is not proof that funds arrived.
- Manual proof approval requires admin verification.
- Legacy `payment-confirm` is disabled by default. Set `BLOCKHOST_ENABLE_LEGACY_PAYMENT_CONFIRM=true` only if the old module is intentionally needed.
- Never commit `.env`, `data/`, payment proofs, node keys, admin keys, or provider secrets.
