---
name: support-mining
description: Use when turning store reviews, support threads, crash clusters or feedback into ranked product findings — by data-analyst post-launch, and by product-researcher when existing user evidence is the question. A review-mining pass, not a standing role.
---

# Support mining

Users describe symptoms, in their own words, having already worked around the problem. This is the
pass that turns that into something the board can act on — and the discipline that keeps it from
becoming a list of the loudest complaints.

## Sources, and what each is good for

| Source | Good evidence for | Systematically biased toward |
|---|---|---|
| Store reviews | first-run and pricing friction | the delighted and the furious, never the middle |
| Support threads | reproducible defects | users willing to write in — a small, patient minority |
| Crash clusters | the truth about stability | devices and OS versions you have most of |
| Uninstall / churn signals | where value failed to land | nothing at all about why |

**Name the bias in the report.** A finding from reviews alone is a finding about reviewers.

## The pass

1. **Cluster by user-described symptom, not by your guess at the cause.** "Photos disappeared" and
   "lost my edits" may be one defect or three; keep them separate until evidence merges them.
2. **Rank by `frequency × severity × recency`**, and show all three columns. A cluster ranked by
   volume alone buries the data-loss report mentioned twice.
3. **Attach evidence to each cluster** — verbatim quotes with dates, app version, device and OS
   where available. A cluster with no verbatim is your paraphrase, and you label it as such.
4. **Separate a defect from a missing feature from a misunderstanding.** All three arrive as "it
   doesn't work" and they route to three different people. A misunderstanding is a
   `content-design` finding, not a bug.
5. **Check each cluster against `knowledge/failure-corpus.md`.** A cluster matching a known class
   that already has a shipped rule is a **recurrence** — the rule did not work, and that is a
   strictly more valuable finding than the incident.

## The rules

- **Never fabricate or paraphrase a quote into something cleaner.** Verbatim or nothing.
- **A cluster is not a ticket.** Hand `qa-engineer` a reproduction attempt; a bug filed from a review
  without one wastes a developer's day.
- **Report what you could not tell.** Reviews rarely say version or device; guessing which release
  regressed is how a good release gets rolled back.

## Output

A dated `## Support findings` section in `docs/51-bugs.md`: ranked clusters with their three scores,
verbatim evidence, the classification (defect · missing feature · misunderstanding · recurrence of
FC-NNN), and the proposed owner for each.
