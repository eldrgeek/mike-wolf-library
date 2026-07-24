---
title: "How to talk with an LLM: context"
collection: "70YearsWTF"
kind: "post"
order: 0
date: "2025-11-02"
author: "Mike Wolf"
original_url: "https://70yearswtf.substack.com/p/how-to-talk-with-an-llm-context"
excerpt: "![](/media/70yt/how-to-talk-with-an-llm-context/1.jpg) Each chat with an LLM is a conversation with a context. Same for people. When two people start a conversation, context is established even before the first word is spoken. It’s based…"
word_count: 2032
tags:
  - "70YearsWTF"
  - "70YearsWTF"
  - "AI"
  - "automation"
related:
  - "70yearswtf-believe-not-what-is-true-but-what-19-05-15"
  - "70yearswtf-do-ideas-exist"
  - "70yearswtf-everything-is-an-idea"
  - "70yearswtf-everything-is-full-of-ideas"
  - "70yearswtf-i-am-an-idea-part-1-its-all-about"
---

![](/media/70yt/how-to-talk-with-an-llm-context/1.jpg)

Each chat with an LLM is a conversation with a context. Same for people.

When two people start a conversation, context is established even before the first word is spoken. It’s based on where they are, what is going on around them, what they are doing, how they are dressed, and how they behave. The very fact that they are both humans establishes some context.

Not quite so for LLMs.

When a human engages with an LLM. The LLM’s context is initially only its training data and its system prompt. (More on that later) Each time a new conversation starts, context resets. Newer LLMs are able to recall previous conversations, and that can add to the context. But it doesn’t necessarily happened the way it happens with people.

There are two intelligences in the conversation. There is a machine intelligence, and there is a human intelligence. One is made of silicon, the other is made out of meat.

See: [“We’re made out of meat.”](https://70yearswtf.substack.com/p/were-made-out-of-meat-19-03-28?utm_source=publication-search)

You come with your own context. If you’ve never used an LLM before, you come with what you know—or rather what you think you know, about LLMs.

If you used one a year ago, what you think you know is likely worse than wrong.

Today’s LLMs are very different from the ones a year ago. They’re very different from the ones a half a year ago. They are actually pretty different from the ones last week.

Every LLM is different. It has different propensities, it has different capabilities, it has a different personality. Yes! A personality!

If your experience is only working with Gemini, for example, and you start a conversation with Grok, you’re talking to an entirely different kind of LLM

## Context Windows

Different models have different “context windows.”

> When ChatGPT first launched in November 2022, its context window was **4,096 tokens**. This was based on the underlying GPT-3.5 model, which later received an upgrade to an 8,192-token context window.

4,096 tokens is about 3,000 words, which is about fifteen minutes of speech.

Now models have much larger context windows.

> Current frontier models have context windows ranging from **128,000 to over 1 million tokens**. Some notable examples include Google’s Gemini 1.5 Pro (1 million+ tokens), OpenAI’s GPT-4o (128,000 tokens) and GPT-5 (400,000 tokens), Mistral’s models (up to 131,000 tokens), and Claude’s 500,000 to 1 million token capacity (beta).

If you’ve ever seen the movie Memento, you’ve got a good head start on understanding context windows.  Gemini sez ([full conversation here](https://gemini.google.com/share/f9a0981383c4))

> The movie *Memento* is an **analogy for LLM context windows**.
>
> - **Leonard’s Amnesia** = An LLM’s **stateless nature** (it forgets past interactions).
> - **The Context Window** = Leonard’s **limited short-term memory** (the small amount of information the AI can process at one time).
> - **Leonard’s Tattoos/Notes** = **External memory systems** (like RAG and chat history) that developers use to feed the model the necessary context for each new interaction, creating the **illusion of memory**.

To have a productive conversation with an LLM, you need to understand its context window and how it behaves as this context window becomes full.

# Ask the model

The way to get to know a model is to talk to it. So my question is:

> How big is your context window, and how do you manage it?

### Grok

> My context window is 256,000 tokens. This is the maximum amount of input (your messages + my previous responses + any system prompts) that I can actively consider when generating a reply.
>
> ### How I manage context
>
> 1. **Token-based sliding window**Conversations are tokenized (broken into sub-word units).
> 2. The system keeps the most recent tokens that fit within 256 k.
> 3. Older messages are **truncated from the left** (i.e., the beginning of the conversation) when the total exceeds the limit.
> 4. **Preservation of recent interaction**Your latest message is always included in full.
> 5. My previous responses are kept until they push the total over the limit.
> 6. If a single message exceeds 256 k (very rare), it would be truncated, but in practice this doesn’t happen.
> 7. **No persistent memory across sessions**Each new chat starts fresh.
> 8. Within a single thread, context is maintained until the window fills.
> 9. **Efficient encoding**I use the same tokenizer as Grok-1/Grok-2 (a custom BPE variant).
> 10. Rough rule of thumb: ~750–800 words ≈ 1,000 tokens.
>
> If you need to reference something from early in a long conversation, you can copy-paste it into a new message to re-introduce it into the active context.

## ChatGPT

> My context window is **roughly 128,000 tokens** (about **300 pages of text**), though how I *use* it matters more than the raw size.
>
> Here’s how I manage context:
>
> ---
>
> ### 🧠 1. **Short-Term Context (working memory)**
>
> This is everything currently visible in our conversation—what you and I have said recently.
> I use it dynamically:
>
> - I keep the most relevant and recent turns fully in focus.
> - I compress or summarize earlier ones if they’re less relevant to the current topic.
> - When the conversation gets long, I may drop fine-grained details (e.g., exact wording) while retaining high-level meaning and relationships.
>
> ---
>
> ### 📘 2. **Long-Term Context (memory)**
>
> Separate from the window, I can store structured facts about you (e.g., your projects, interests, relationships) in *memory entries* that persist between chats.
> These entries aren’t in the live context window—they’re selectively *injected* when relevant.
>
> Example:
>
> You mentioned working on YeshID or that Bobbi passed away — I don’t “see” the original messages, but I have that remembered fact in my long-term memory and can use it.

---

### ⚙️ 3. **Compression & Relevance Ranking**

When context approaches the 128k limit:

- I rank earlier messages by relevance to your current intent.
- I keep high-relevance items verbatim.
- I replace lower-relevance sections with summaries or embeddings that preserve meaning but not wording.
- If needed, I discard what’s least relevant.

---

### 🔍 4. **Retrieval-Style Recall**

For longer-running projects or uploads, I can simulate “infinite” memory by using **vector retrieval** (searching stored embeddings) — like a knowledge base you can query.
For example, when you ask, “Remind me what I said about Rewind,” I can recall that entry from your stored context, even if it’s far beyond the live window.

---

### 🔄 5. **Context Management in Practice**

If you notice I lose track of a thread, it’s usually because:

- We’ve exceeded the active window and older text fell out.
- My summarization or relevance weighting missed a connection.
  In those cases, you can just remind me briefly (“We were discussing how Yeshie learns from actions”), and I can rebuild focus quickly.

---

Would you like me to explain **how I decide what’s relevant** (e.g., the internal heuristics for weighting and summarization), or how you can **explicitly control** what stays in context (via “anchors,” summaries, or pinned prompts)?

## Claude

> My context window is **200,000 tokens** (roughly 150,000 words, though this varies with the text).
>
> In terms of how I manage context:
>
> **Within a conversation:**
>
> - I have access to the entire conversation history simultaneously - it’s not that I “retrieve” earlier messages, I can attend to any part of the context equally
> - Each time I respond, I process the full context from scratch
> - However, there’s a practical caveat: while I *can* access the full 200K tokens, my performance at utilizing information does degrade somewhat in very long contexts, particularly for information in the middle of very long conversations (this is a known characteristic of transformer architectures)
>
> **Across conversations:**
>
> - I have a memory system that creates persistent memories from our conversations (you can see this reflected in the context above where information about your AAC work with Dr. Shane, your browser automation projects, and your philosophical interests is summarized)
> - These memories update periodically but aren’t real-time - recent conversations might not be reflected yet
> - This is separate from the 200K token window of the current conversation
>
> **No hidden state:**
>
> - I don’t have internal working memory or “thoughts” that persist between responses
> - Everything I know about our current conversation is visible in the context window
> - There’s no background process maintaining state
>
> Given your work with LLM architectures and the MCP servers, you’re probably aware that this “stateless but full-context” design is quite different from how human working memory operates - we maintain threads and state, while I reconstruct understanding from scratch each time, albeit very quickly.

### Gemini

> That’s an excellent and technical question!
>
> I can speak to the general capabilities of the family of models I am based on, Gemini:
>
> ### 🌟 Context Window Size
>
> Many models in the Gemini family, particularly versions like **Gemini 1.5 Pro** and **Gemini 1.5 Flash**, feature a significantly large context window.
>
> - The standard long context window is **1 million tokens** (with a token being roughly equivalent to a word or part of a word).
> - For advanced use cases, some Gemini 1.5 models have been made available with an **up to 2-million-token** context window.
>
> This large size is a major breakthrough that allows the model to process a massive amount of information in a single go—for example, a very long document, an entire codebase, or the content of many hours of video and audio.
>
> ---
>
> ### 🧠 How Context Is Managed
>
> Context management is how the model keeps track of the conversation and relevant information to generate a coherent and helpful response. The strategies include:
>
> 1. **The Context Window (Short-Term Memory):**The most immediate form of context is the **current conversation history** (your prompt and my previous responses) which is passed to the model with every turn. This ensures continuity, like the short-term memory of a human.
> 2. Because the window is so large (1 million+ tokens), the model is very good at tasks like **summarizing huge texts** or performing **“in-context learning”** (learning a new skill from examples provided directly in the prompt).
> 3. **System Instructions (Guiding Principles):**The model is given **system-level instructions** (like my core guidelines and persona) at the beginning of a session. This is a persistent context that guides my behavior, tone, and constraints throughout our conversation.
> 4. **External Augmentation (RAG):**For tasks requiring up-to-date or specific external knowledge (like answering questions about current events or technical details), a technique like **Retrieval-Augmented Generation (RAG)** is often used.
> 5. This involves first **retrieving** the most relevant information from a search tool (like the Google Search I used just now) and then **inserting** that retrieved text into my context window before generating the final answer. This helps me provide accurate and timely information beyond my core training data.
>
> In essence, context management is about ensuring the model has the *right* set of tokens—a mix of conversation history, guiding rules, and relevant external data—to produce the best possible answer for your current request.

# Summary

ChatGPT has the most comprehensive context management system. Even though its context window is the smallest, it makes the very best use of what it has.

Claude’s context management system causes it to run into troubles when chats get long. When the context window gets filled up, Claude just can’t do anything. This is especially annoying when I want to continue a conversation and have Claude summarize the previous conversation. It just can’t do it!

Gemini solves the problem with brute force. A 1M-2M token context window is huge.

Grok has a sliding window. Which means that as the conversation goes on, it forgets the early parts of the conversation.

When you have a short conversation with an LLM, these things don’t matter that much. But as your conversations become longer and more nuanced, managing context becomes increasingly important. And especially if you’re doing something like writing code.

Also, you can read this:
