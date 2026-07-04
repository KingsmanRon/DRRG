# DRRG Patient Onboarding

An internal patient onboarding and register application for Dr Refiloe G's cash patients.

## Scope

1. Authenticated doctor and staff access.
2. Cash patient onboarding.
3. South African ID, passport, other foreign document and no document support.
4. Exact identity duplicate blocking.
5. Soft duplicate review using name, date of birth and phone.
6. Patient search, consent capture and audit history.

Clinical notes, billing and medical aid workflows are deliberately excluded.

## Duplicate control

The system uses two levels of duplicate protection.

1. A South African ID is a hard unique identifier. A matching ID cannot create another patient.
2. A passport or foreign document is unique by document type, issuing country and normalised document number.
3. Patients without an identity document can still be registered when staff record the reason.
4. Name, date of birth and mobile number combinations produce possible match warnings.
5. An exact mobile number also produces a warning because a returning patient may provide changed or mistyped personal details.
6. Possible matches do not automatically block registration because relatives can share names, dates of birth or mobile numbers. Staff must review every match and record why a separate patient is being created.

South African mobile numbers are normalised so local `082...` and international `+27 82...` formats match one another.

Residential address is stored for administration but is not used for duplicate matching. Address spelling changes frequently and several patients can legitimately share one address.

## Local setup

1. Install Node.js 20.9 or later.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and add a dedicated DRRG Supabase project.
4. Apply the migrations in `supabase/migrations`.
5. Run `npm run dev`.

For local interface verification without a database, set `DRRG_DEMO_MODE=true`. This must never be enabled in production.
