---
title: "Ideal writing environment"
collection: "70YearsWTF"
kind: "post"
order: 0
date: "2018-07-22"
author: "Mike Wolf"
original_url: "https://70yearswtf.substack.com/p/ideal-writing-environment-18-07-22"
excerpt: "Periodically, I get to thinking (whining) about improving my writing environment. I’ve got ideas about an ideal environment. I’d like to turn those ideas into reality. Or at least to turn them into a blog post. My current environment is a…"
word_count: 1032
tags:
  - "70YearsWTF"
  - "70YearsWTF"
  - "blogging"
  - "automation"
related:
  - "70yearswtf-believe-not-what-is-true-but-what-19-05-15"
  - "70yearswtf-do-ideas-exist"
  - "70yearswtf-everything-is-an-idea"
  - "70yearswtf-everything-is-full-of-ideas"
  - "70yearswtf-i-am-an-idea-part-1-its-all-about"
---

Periodically, I get to thinking (whining) about improving my writing environment. I’ve got ideas about an ideal environment. I’d like to turn those ideas into reality. Or at least to turn them into a blog post.

My current environment is a patchwork. And I’ve done some experiments. I’m up the learning curve on Google’s APIs and the node/javascript ecosystem and development environments.

I can build it. And maybe I’m gonna.

## Current process

I dictated the first draft of this post using Google Docs on my Android phone. Now I’m editing with a browser-based version of Google Docs. I use the keyboard to navigate and make smaller changes, and Voice Typing for larger changes and additions.

When I finish this version (I have) I will select and copy what I’ve written, switch to Blogger, start a new post, and paste what I copied. (Which I have done.) In Blogger I’m doing a little more editing because things look different. And I’m using [Grammarly](https://www.grammarly.com/) to catch spelling and grammar errors.

I write posts in [Markdown](https://daringfireball.net/projects/markdown/syntax), and when I’m done I hit some magic keys that tell a Chrome Extension called [Markdown Here](https://markdown-here.com/) to change the Markdown to HTML right in Blogger. So I can preview it. Then I tag it and I publish it. Half the time I’ve undone the Markdown to HTML conversion and I forget to convert it to Markdown before I publish, so I need to go back and convert it. Sometimes I forget to tag it. Sometimes I forget what tags I’m using, and make shit up.

### What sucks

Starting a new post is a bunch of keystrokes and long waits. Sucks!

Copy pasting between Google Docs and Blogger sucks.

Adding links from reference sources sucks. If I’m writing, and I realize I’m going to want to add a link, I will use the Markdown convention and put the link text in square brackets and follow it with an open and close parenthesis. The idea is that I will later go back and fill in the URL between parentheses. Sometimes I forget. That sucks.

If I’ve found an article to link to and I want to link to it, by name I can’t just copy/paste title. If I do, I get the text and the link, but I also get a bunch of extraneous formatting. So it looks like shit. That sucks! And if the title doesn’t link to itself, as sometimes happens. It does no good even if it looks like crap.

Instead, I have to be in the tab with the article, select the title. Then copy it, switch to Blogger, paste it without formatting. Then I have to put right and left square brackets around what I just pasted. Then I add an open paren. Then switch back to the tab with the article. Then select the URL from the nav bar and copy it. Then go back to the tab with the blog post. Then paste the URL. And then type the closing parenthesis. Sucks.

If I am quoting text from an article, I have to select and copy the text, switch to Blogger, paste the text without formatting, then the Markdown formatting to make it a quote. Finally something easy. In Markdown, a `>` at the start of the line does the trick. If the text has links and I’d like to preserve them, pasting without formatting loses them all. Sucks! So I have to go back and copy each link and do the square brackets thing and the parens. Sucks.

If I want to link to other posts that I’ve written on the same topic, I have to use Google search to find the posts then painstakingly copy paste a link to each into my new post. Sucks!

Then I have to figure out how to tag this post. I don’t have a good taking scheme, so that’s a pain. Better tools won’t help so much as a better system. But tools could.

And I have to remember the convert from markdown to HTML which I forget about half the time. And remember to add the links for which I’ve added placeholders.

And if I want to do anything more than the simplest kind of editing—like replace one word with another throughout the document I can’t. I have to do them one at a time. Or copy/paste into another editor and copy/paste back. Sucks!

### What I’d like

I’d like to go to one place and do everything. Start a post. Voice type. Edit (with some power commands). Check with Grammarly. Add links and text with links more easily. Easily find and add links to my other posts. Preview the Markdown. Check for errors. Automatically convert from Markdown and post to my blog.

### Step by step

To start, I can create a project in [Glitch](https://glitch.com/) that has an editor that will let me type, preview markdown, and then use the Blogger API to post. Automagically Grammarly will work. After that things get incrementally better. So the functions are:

- Basic editing
- Markdown preview
- Post to blog

Post to blog initially means “post to [78YearsOldWTF](https://70yearsoldwtf.blogspot.com/) but I can expand that. I have a bunch of blogs I want to post to. So pick one and go. Why not!

There’s a browser speech recognition API that’s easy to use. It might not be as good at the Google Cloud one but it might use Google cloud secretly in the background. I don’t know. But I can add speech then make it better. So the next step is:

- Add speech

Now I can add some little helper functions like:

- ^K on selected text uses Markdown conventions
- ^V with [tagged content converts it](https://www.blogger.com/null)

[The more I write, the simpler this seems to get! Post and give it a try.](https://www.blogger.com/null)

[](https://www.blogger.com/null)
