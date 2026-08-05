# Interface fidelity ledger

## Comparison points

1. Copy and hierarchy: the implementation preserves the DRRG Patient Onboarding header, Patients heading, New patient action, search, recent patients table and duplicate warning language.
2. Layout: the dashboard retains the open page structure, restrained header and table driven register. The onboarding flow retains the four step structure and two column form layout.
3. Typography: headings, labels, controls and table cells use deliberate sizes and weights. File numbers use tabular numerals.
4. Palette: the implementation uses true white, deep forest green, pale sage, charcoal and amber warning colours from the concepts. No gradients or decorative imagery were introduced.
5. Controls: buttons, fields, checkboxes, focus states and warning panels use consistent borders, radii and spacing.
6. Responsive behaviour: the patient table becomes labelled mobile rows and form fields become one column at 390 pixels without horizontal overflow.

## Material fixes made during comparison

1. Removed the sticky action bar after it obscured consent controls on shorter desktop viewports.
2. Removed the development indicator from final browser captures.
3. Changed form section labels to semantic headings.
4. Added explicit mobile table labels and full width actions.
5. Preserved masked identity numbers in the patient list.

## Intentional deviations

1. The concept showed personal details and identity fields together. The implementation separates them into consecutive steps to reduce form density and validation ambiguity.
2. The concept showed a Review button per duplicate candidate. The implementation requires one explicit review confirmation and a written reason covering every candidate, which creates stronger audit evidence.
3. Adding a person to an existing file does not use the four step structure at all. It is a single screen: the file supplies the number, the contact details and the consent, so the only questions left are the person's name and how they are identified. Deviation 1 is reversed here on purpose — with three fields on screen, splitting identity from personal details would be density for its own sake. The four step form remains as designed for opening a new file.
4. Contact details and consent appear on that screen as stated values rather than fields, with a link that turns the contact details back into fields. A value that is almost always right is quieter as a sentence than as a pre-filled input, but it stays correctable, because a household member who lives elsewhere is a real case.

## Verification artefacts

1. `dashboard-concept.png`
2. `dashboard-implementation.png`
3. `onboarding-concept.png`
4. `onboarding-implementation.png`
