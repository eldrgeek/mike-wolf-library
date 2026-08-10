---
letter: "T"
title: "two-kinds rule"
subtitle: "system failures and user errors get handled differently"
theme: "Architecture & Roles"
authored_by: "Mike Wolf & the SOMA fleet"
origin: "Internal SOMA canon — working dialect, unpublished (SOMA Lexicon, 2026-07-24)."
origin_html: "Internal SOMA canon — working dialect, unpublished (SOMA Lexicon, 2026-07-24)."
source: "Internal SOMA canon — working dialect, unpublished (SOMA Lexicon, 2026-07-24)."
related:
  - "rsi-loop"
  - "the-dark-factory-with-a-glass-wall"
provenance: []
tags:
  - "dialect"
  - "architecture"
---

<p><strong>What we mean.</strong> An error-handling doctrine. When something breaks, first ask which <em>kind</em> of failure it is. A system/engine failure shows the user a calm "our AI team is on it" and quietly files a ticket. A genuine user-input error shows inline guidance and files <em>nothing</em>. The two are never conflated — users shouldn't see stack-trace panic for their own typo, and real bugs shouldn't hide as if they were the user's fault.</p>
