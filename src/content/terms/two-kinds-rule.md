---
letter: "T"
title: "two-kinds rule"
subtitle: "system failures and user errors get handled differently"
theme: "Architecture & Roles"
authored_by: "Mike Wolf & the SOMA fleet"
source: ""
related:
  - "rsi-loop"
provenance: []
tags:
  - "architecture"
---

<p><strong>What we mean.</strong> An error-handling doctrine. When something breaks, first ask which <em>kind</em> of failure it is. A system/engine failure shows the user a calm "our AI team is on it" and quietly files a ticket. A genuine user-input error shows inline guidance and files <em>nothing</em>. The two are never conflated — users shouldn't see stack-trace panic for their own typo, and real bugs shouldn't hide as if they were the user's fault.</p>
