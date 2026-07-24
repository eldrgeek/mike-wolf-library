import { defineCollection, z } from 'astro:content';

// ── Dictionary: cross-referenced term entries (the SOMA Lexicon) ──────────────
const terms = defineCollection({
  type: 'content',
  schema: z.object({
    letter: z.string(),
    title: z.string(),
    subtitle: z.string().optional(),
    theme: z.string().optional(),        // Philosophy & Doctrine, Architecture & Roles, etc.
    authored_by: z.string().default('Mike Wolf & the SOMA fleet'),
    origin: z.string().optional(),       // coinage credit line
    source: z.string().default(''),
    related: z.array(z.string()).default([]),      // other term slugs
    provenance: z.array(z.string()).default([]),   // source slugs where the term is discussed
    tags: z.array(z.string()).default([]),
    link: z.string().url().optional(),             // external site the term names (e.g. Macho Glue)
    link_label: z.string().optional(),             // link text (defaults to the domain)
  }),
});

// ── Corpus: long-form sources (books, essays, posts) ──────────────────────────
// Full text is hosted here and rendered on individual reading pages.
const sources = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    collection: z.string(),   // SRMW | Silicon Children | 70YearsWTF | AI WTF
    kind: z.string(),         // book-section | essay | manifesto | post | draft
    order: z.number().default(0),
    date: z.string().nullable().optional(),
    author: z.string().default('Mike Wolf'),
    original_url: z.string().nullable().optional(),
    excerpt: z.string().default(''),
    word_count: z.number().default(0),
    tags: z.array(z.string()).default([]),
    related: z.array(z.string()).default([]),  // other source slugs
  }),
});

export const collections = { terms, sources };
