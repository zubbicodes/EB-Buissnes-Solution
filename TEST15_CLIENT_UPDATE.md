# Test 15 follow-up implementation

Good evening,

Thank you for the detailed Test 15 feedback. The points raised have now been addressed as follows.

## Mapping and FIFO behaviour

A third allocation permission has been added to client mappings:

1. **Identification only** identifies the debtor and may offer one unambiguous invoice for review.
2. **FIFO proposals permitted** proposes an allocation against the debtor's oldest open invoices and requires confirmation.
3. **FIFO auto-allocation permitted** automatically applies the payment against the debtor's oldest open invoices.

The automatic option is deliberately opt-in. Existing mappings retain their current behaviour until their permission is changed. Automatic FIFO allocations retain the standard controls:

- explicit invoice-reference matches continue to take precedence;
- only active mappings belonging to the client are considered;
- conflicting mappings remain subject to manual review;
- overlapping mappings use the most restrictive permission;
- underpayments, overpayments and unavailable balances continue through the normal status and exception handling;
- the mapping ID, version, source, target debtor and effective permission are retained as review evidence; and
- allocation-run and mapping administration activity remains auditable.

This means the Shackletons mapping can now be changed to **FIFO auto-allocation permitted** when the payer/debtor relationship has been approved. Subsequent runs will then produce actual automatic FIFO allocations instead of recurring suggestions.

## Reference variation matching

Reference variations now recognise the configured phrase within a longer bank narrative. Matching is case-insensitive and normalises punctuation and spacing.

For example, the mapping:

`A. Share . Sons Limited` → `A SHARE & SONS T/A SCS`

will be recognised within narratives such as:

`A. Share . Sons Limited/EREF/1155126087/UETR/...`

Changing EREF, UETR or other transaction-specific suffixes no longer prevent the mapping from being selected. The check also covers both imported reference/narrative and payer/remitter fields because different bank exports place this information in different columns.

## Allocation results

The previous Test 15 behaviour was consistent with the earlier two mapping permissions: the mapping supplied debtor evidence but was not authorised to commit balances. The new automatic permission changes that outcome explicitly. When selected, the run records committed FIFO matches and updated balances; when the existing proposal permission is retained, the result continues to require review.

The supplied Test 14 and Test 15 exports were also compared directly:

- all 1,314 allocation rows, classifications and financial totals are identical;
- the Invoice sheets contain the same 28,143 records and balances, although their display order differs;
- all 22 Shackletons payments remain suggestions, totalling £117,041.96, with no committed allocation;
- all six A. Share payments remain 90% fuzzy suggestions, totalling £2,675,348.70, with no client-mapping evidence; and
- the Shackletons evidence contains two overlapping mapping IDs for the same source and debtor.

For the next test, both Shackletons mappings must be changed to **FIFO auto-allocation permitted**, or the redundant mapping should be deactivated. This follows the most-restrictive-permission safeguard. The supplied invoices contain £66,025.44 of positive open Shackletons balance against £117,041.96 of payments, so automatic FIFO should allocate no more than the available balance. The remaining £51,016.52 should continue through overpayment/unmatched exception handling rather than being forced onto unrelated invoices.

## Performance

Two avoidable sources of work have been removed:

- Client mappings and target-debtor invoice groups are now prepared once per allocation run instead of repeatedly normalising and scanning the full invoice listing for each mapped transaction.
- The application shell now requests a small, purpose-built notification feed instead of repeatedly downloading the full allocation list and up to 1,000 audit records during navigation. Polling is less frequent and no longer restarts on every route change.

These changes target both allocation processing and general screen navigation.

As a local matching-engine check, a synthetic run containing 800 mapped bank transactions and 29,000 invoices completed the matching stage in approximately 1.2 seconds. This measurement covers matching logic only; upload, database and network time depend on the deployment environment.

## Laptop and smaller-screen layout

The desktop shell now scales at common laptop widths instead of reserving the full large-monitor sidebar width. Content padding, search and account controls compress with the viewport, and short laptop displays use a condensed sidebar layout. The sidebar remains vertically scrollable as a final safeguard, keeping the profile and logout control accessible.

## Regression coverage

Coverage has been added for:

- FIFO auto-allocation across multiple invoices in oldest-first order;
- mapping evidence and allocation statistics for automatic matches;
- the most-restrictive-permission rule for overlapping mappings;
- embedded reference phrases with punctuation and changing transaction suffixes;
- narratives supplied through either the reference or payer/remitter field; and
- preservation of the existing identification and FIFO-proposal behaviours.

The focused backend regression suite passed, and the optimized frontend production build completed successfully.

Kind regards,

EB Business Solutions Limited
