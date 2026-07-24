---
title: "What problem are you trying to solve?"
collection: "70YearsWTF"
kind: "post"
order: 0
date: "2018-11-13"
author: "Mike Wolf"
original_url: "https://70yearswtf.substack.com/p/what-problem-are-you-trying-to-solve-18-11-13"
excerpt: "In a previous post, Implementing a better chair in the sky, Past Me told me to figure out what problem I was trying to solve before solving it. Since Past Me often gives Present Me good advice, then-Present Me listened…"
word_count: 464
tags:
  - "70YearsWTF"
  - "blogging"
related: []
---

In a previous post, [Implementing a better chair in the sky](https://70yearsoldwtf.blogspot.com/2018/11/after-i-wrote-first-draft-of-my-ranty.html), Past Me told me to figure out what problem I was trying to solve before solving it. Since Past Me often gives Present Me good advice, then-Present Me listened to it. (This is another Present Me writing this for the benefit of Future Me)

See: [70 Years Old. WTF!: Thank you, Past Me. Thank you, random stranger](https://70yearsoldwtf.blogspot.com/2017/07/thank-you-past-me-thank-you-random.html)

So the problem I was trying to solve is this one: I’m finishing up a post. I need to get some links. That’s annoying. I have to take the text where I want the link to be, put square brackets around it, and an open paren, then find the page I want, go to the omnibar, select the URL if it’s not selected, type Ctrl-C, go back to my document, type Ctrl-V, and then close the tab. Annoying. [Chair in the sky annoying!](https://70yearsoldwtf.blogspot.com/2018/11/when-your-chair-in-sky-is-just-not.html)

And if I want to link to the title of the article, like when citing my own post, it's: look the post. Select the title. Ctrl-C. Back to the post that I am composing. Type [, Ctrl-V and then ] and (, back to the document. Click in the link. Ctrl-C. Back to the post, Ctrl-C again, and then (whew!) Ctrl-V.

So the problem is: I want to take a URL that’s on my clipboard and converted to [Markdown](https://en.wikipedia.org/wiki/Markdown).

So just
fuckingask Google. Or should it be: So just ask
fuckingGoogle. (I’m never sure where the fucking emphasis fucking goes.)

URL to Markdown? Easy! How about this package from the amazing Sondre Sunderhus: [sindresorhus/urls-md: Convert URLs to Markdown links: Extracts URLs from text → Gets their article title → Creates Markdown links](https://github.com/sindresorhus/urls-md)Chrome extension.

Which uses this one: [sindresorhus/get-urls: Get all urls in a string](https://github.com/sindresorhus/get-urls) and [sindresorhus/article-title: Extract the article title of a HTML document](https://github.com/sindresorhus/article-title)

Or convert HTML to markdown using [HTML to Markdown Converter - Markdown Editor - Online - Browserling Web Developer Tools](https://www.browserling.com/tools/html-to-markdown) Or maybe this one: [Paste to Markdown](https://euangoddard.github.io/clipboard2markdown/) with the code on GitHub here: [euangoddard/clipboard2markdown: Convert rich-text on your clipboard to markdown](https://github.com/euangoddard/clipboard2markdown)

Wow! That’s a lot of links! It must have been hard to do all that copying and pasting and typing. But I didn’t! I used a Chrome extension: [Copy as Markdown - Chrome Web Store](https://chrome.google.com/webstore/detail/copy-as-markdown/fkeaekngjflipcockcnpobkpbbfbhmdn/related?hl=en) Yeah, but can I use that without the environment? You can if you go to his GitHub project: [chitsaou/copy-as-markdown: Copying Link, Image and Tab(s) as Markdown Much Easier.](https://github.com/chitsaou/copy-as-markdown/)

But I want a shortcut that does that.

Easy. Go to the [Extensions](chrome://extensions/) page, and under the hamburger menu pick “[Keyboard Shortcuts](chrome://extensions/shortcuts) and assign away. Every extension that lets you have keyboard shortcuts publishes its setting there.

Who knew?

And before I forget it, maybe this: [mikecrittenden/shortkeys: A browser extension for custom keyboard shortcuts](https://github.com/mikecrittenden/shortkeys)
