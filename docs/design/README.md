# DRRG interface specification

The dashboard and onboarding concepts in this folder are the visual source of truth for the initial implementation.

## Product surface

1. Internal patient register for Dr Refiloe G and authorised reception staff.
2. Cash patients only.
3. Patient onboarding, search, consent and duplicate review.
4. No clinical notes, billing or medical aid workflow.

## Design system

1. True white page background.
2. Deep forest green `#064f36` for primary actions and focus.
3. Charcoal `#24262b` for primary text.
4. Muted grey `#626970` for supporting text.
5. Pale sage `#f3f8f5` for quiet section emphasis.
6. Amber `#a45c00` and `#fff8e8` only for duplicate warnings.
7. Light grey `#d8ddda` borders with minimal shadow.
8. Modest `6px` control radius and `8px` panel radius.
9. System sans serif typography with deliberate control sizing.

## Component families

1. Restrained application header.
2. Primary and secondary buttons.
3. Search input.
4. Table on desktop and labelled rows on mobile.
5. Four step onboarding progress.
6. Two column form grid that becomes one column on mobile.
7. Duplicate candidate panel with explicit review action.
8. Inline validation and a full success state.

## Core interaction

The staff member opens New patient, captures personal and identity details, reviews any possible matches, captures contact details and consent, then saves the patient. Exact document matches are blocked. Soft matches require a recorded review before saving.
